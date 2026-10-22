import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/server.js";
import { MAX_TEXT_LENGTH } from "../src/contract.js";
import type { Scorer } from "../src/scorer.js";

const KEY = "test-key";

function fakeScorer(ready = true) {
  const seen: string[] = [];
  const scorer: Scorer = {
    isReady: () => ready,
    score: async (text, labels) => {
      seen.push(text);
      return Object.fromEntries(labels.map((l, i) => [l, 0.1 * (i + 1)])) as never;
    },
  };
  return { scorer, seen };
}

function app(ready = true) {
  return buildApp({ apiKey: KEY, scorer: fakeScorer(ready).scorer });
}

const analyze = (body: unknown, key: string | null = KEY) =>
  app().inject({
    method: "POST",
    url: `/v1alpha1/comments:analyze${key === null ? "" : `?key=${key}`}`,
    payload: body as object,
  });

const goodBody = {
  comment: { text: "you are great" },
  languages: ["en"],
  requestedAttributes: { TOXICITY: {} },
};

function assertError(res: { statusCode: number; json(): any }, code: number) {
  assert.equal(res.statusCode, code);
  const body = res.json();
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, "string");
}

// --- Auth ---

test("401 when the key is missing", async () => {
  assertError(await analyze(goodBody, null), 401);
});

test("401 when the key is empty", async () => {
  assertError(await analyze(goodBody, ""), 401);
});

test("403 when the key is wrong", async () => {
  assertError(await analyze(goodBody, "nope"), 403);
});

test("suggestscore also requires the key", async () => {
  const res = await app().inject({
    method: "POST",
    url: "/v1alpha1/comments:suggestscore",
    payload: { comment: { text: "x" } },
  });
  assertError(res, 401);
});

// --- Validation ---

test("400 for malformed JSON", async () => {
  const res = await app().inject({
    method: "POST",
    url: `/v1alpha1/comments:analyze?key=${KEY}`,
    headers: { "content-type": "application/json" },
    payload: "{not json",
  });
  assertError(res, 400);
});

test("400 when comment is missing", async () => {
  assertError(await analyze({ requestedAttributes: { TOXICITY: {} } }), 400);
});

test("400 for empty or whitespace-only text", async () => {
  assertError(await analyze({ ...goodBody, comment: { text: "" } }), 400);
  assertError(await analyze({ ...goodBody, comment: { text: "   " } }), 400);
});

test("400 for text over the length limit", async () => {
  const text = "a".repeat(MAX_TEXT_LENGTH + 1);
  assertError(await analyze({ ...goodBody, comment: { text } }), 400);
});

test("400 when requestedAttributes is empty", async () => {
  assertError(await analyze({ ...goodBody, requestedAttributes: {} }), 400);
});

test("400 for an unsupported attribute, naming it", async () => {
  const res = await analyze({
    ...goodBody,
    requestedAttributes: { TOXICITY: {}, FLIRTATION: {} },
  });
  assertError(res, 400);
  assert.match(res.json().error.message, /FLIRTATION/);
});

test("400 for non-English languages", async () => {
  assertError(await analyze({ ...goodBody, languages: ["fr"] }), 400);
});

// --- Success shape ---

test("200 with Perspective response shape", async () => {
  const res = await analyze({
    ...goodBody,
    requestedAttributes: { TOXICITY: {}, INSULT: {} },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(body.languages, ["en"]);
  assert.deepEqual(Object.keys(body.attributeScores).sort(), ["INSULT", "TOXICITY"]);
  for (const attr of ["TOXICITY", "INSULT"]) {
    const s = body.attributeScores[attr];
    assert.equal(s.summaryScore.type, "PROBABILITY");
    assert.ok(s.summaryScore.value >= 0 && s.summaryScore.value <= 1);
    assert.deepEqual(s.spanScores, [
      { begin: 0, end: goodBody.comment.text.length, score: s.summaryScore },
    ]);
  }
});

test("missing languages is treated as English", async () => {
  const { languages: _, ...body } = goodBody;
  const res = await analyze(body);
  assert.equal(res.statusCode, 200);
});

test("en-US is accepted", async () => {
  assert.equal((await analyze({ ...goodBody, languages: ["en-US"] })).statusCode, 200);
});

test("doNotStore is accepted", async () => {
  assert.equal((await analyze({ ...goodBody, doNotStore: true })).statusCode, 200);
});

// --- Model readiness ---

test("analyze returns 503 before the model loads", async () => {
  const res = await app(false).inject({
    method: "POST",
    url: `/v1alpha1/comments:analyze?key=${KEY}`,
    payload: goodBody,
  });
  assertError(res, 503);
});

test("healthz is 503 before the model loads and 200 after", async () => {
  assertError(await app(false).inject({ method: "GET", url: "/healthz" }), 503);
  assert.equal((await app(true).inject({ method: "GET", url: "/healthz" })).statusCode, 200);
});

// --- suggestscore ---

test("suggestscore returns 200 and never calls the scorer", async () => {
  const { scorer, seen } = fakeScorer();
  const res = await buildApp({ apiKey: KEY, scorer }).inject({
    method: "POST",
    url: `/v1alpha1/comments:suggestscore?key=${KEY}`,
    payload: {
      comment: { text: "feedback text" },
      attributeScores: { TOXICITY: { summaryScore: { value: 1 } } },
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(seen.length, 0);
});

// --- Other ---

test("unknown routes return 404 in the error shape", async () => {
  assertError(await app().inject({ method: "GET", url: "/nope" }), 404);
});
