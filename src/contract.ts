// Request validation and Perspective response shaping.
import type { Attribute } from "./mapping.js";

/** Perspective's own limit is 20 KB of text. */
export const MAX_TEXT_LENGTH = 20480;

export interface AnalyzeRequest {
  comment: { text: string };
  languages?: string[];
  requestedAttributes: Record<string, object>;
  doNotStore?: boolean;
}

export const analyzeSchema = {
  body: {
    type: "object",
    required: ["comment", "requestedAttributes"],
    properties: {
      comment: {
        type: "object",
        required: ["text"],
        properties: { text: { type: "string", maxLength: MAX_TEXT_LENGTH } },
      },
      languages: { type: "array", items: { type: "string" } },
      requestedAttributes: { type: "object", minProperties: 1 },
      doNotStore: { type: "boolean" },
    },
  },
} as const;

export const suggestScoreSchema = {
  body: {
    type: "object",
    required: ["comment"],
    properties: { comment: { type: "object" } },
  },
} as const;

export interface ErrorBody {
  error: { code: number; message: string };
}

export function errorBody(code: number, message: string): ErrorBody {
  return { error: { code, message } };
}

export function analyzeResponse(text: string, scores: Partial<Record<Attribute, number>>) {
  const end = [...text].length;
  const attributeScores: Record<string, unknown> = {};
  for (const [attr, value] of Object.entries(scores)) {
    const score = { value, type: "PROBABILITY" };
    attributeScores[attr] = {
      summaryScore: score,
      spanScores: [{ begin: 0, end, score }],
    };
  }
  return { attributeScores, languages: ["en"] };
}
