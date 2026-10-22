// HTTP routes and API-key check. See PLAN.md "Architecture" and "API contract".
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  analyzeResponse,
  analyzeSchema,
  errorBody,
  suggestScoreSchema,
  type AnalyzeRequest,
} from "./contract.js";
import { isEnglish } from "./language.js";
import { ATTRIBUTE_TO_LABEL, isSupportedAttribute, type Attribute } from "./mapping.js";
import type { Scorer } from "./scorer.js";

export interface AppOptions {
  apiKey: string;
  scorer: Scorer;
}

function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildApp({ apiKey, scorer }: AppOptions) {
  // Fastify's logger is off: its request logs include the URL, which carries ?key=.
  const app = Fastify({ logger: false });

  app.setErrorHandler((err: { statusCode?: number; message: string }, _req, reply) => {
    const code = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    const message = code === 500 ? "Internal error" : err.message;
    reply.code(code).send(errorBody(code, message));
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send(errorBody(404, "Not found"));
  });

  const requireKey = async (req: FastifyRequest, reply: FastifyReply) => {
    const key = (req.query as Record<string, unknown>).key;
    if (typeof key !== "string" || key === "") {
      return reply.code(401).send(errorBody(401, "API key missing"));
    }
    if (!keyMatches(key, apiKey)) {
      return reply.code(403).send(errorBody(403, "API key invalid"));
    }
  };

  app.get("/healthz", async (_req, reply) => {
    if (!scorer.isReady()) return reply.code(503).send(errorBody(503, "Model not loaded"));
    return { status: "ok" };
  });

  // "::" is Fastify's escape for a literal ":" in a path; the URL is /comments:analyze.
  app.post<{ Body: AnalyzeRequest }>(
    "/v1alpha1/comments::analyze",
    { schema: analyzeSchema, onRequest: requireKey },
    async (req, reply) => {
      const { comment, languages, requestedAttributes } = req.body;

      if (comment.text.trim() === "") {
        return reply.code(400).send(errorBody(400, "comment.text must not be empty"));
      }
      const requested = Object.keys(requestedAttributes);
      const unsupported = requested.filter((a) => !isSupportedAttribute(a));
      if (unsupported.length > 0) {
        return reply
          .code(400)
          .send(errorBody(400, `Unsupported attribute(s): ${unsupported.join(", ")}`));
      }
      if (!isEnglish(languages)) {
        return reply.code(400).send(errorBody(400, "Only English (en) is supported"));
      }
      if (!scorer.isReady()) {
        return reply.code(503).send(errorBody(503, "Model not loaded"));
      }

      const attrs = requested as Attribute[];
      const labelScores = await scorer.score(
        comment.text,
        attrs.map((a) => ATTRIBUTE_TO_LABEL[a]),
      );
      const scores = Object.fromEntries(
        attrs.map((a) => [a, labelScores[ATTRIBUTE_TO_LABEL[a]]]),
      );
      return analyzeResponse(comment.text, scores);
    },
  );

  // Feedback from moderators. Accepted and discarded; nothing is stored.
  app.post(
    "/v1alpha1/comments::suggestscore",
    { schema: suggestScoreSchema, onRequest: requireKey },
    async () => ({}),
  );

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = process.env.PERSPECTIVE_API_KEY;
  if (!apiKey) {
    console.error(JSON.stringify({ event: "startup_error", message: "PERSPECTIVE_API_KEY not set" }));
    process.exit(1);
  }
  // TODO: replace with the real TF.js scorer once it is implemented.
  const scorer: Scorer = {
    isReady: () => false,
    score: async () => {
      throw new Error("Scorer not implemented");
    },
  };
  const port = Number(process.env.PORT ?? 8080);
  await buildApp({ apiKey, scorer }).listen({ port, host: "0.0.0.0" });
  // Never log the query string or comment text.
  console.log(JSON.stringify({ event: "listening", port }));
}
