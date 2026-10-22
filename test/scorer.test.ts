// Runs against the real model. Skipped when ./model is missing (run `npm run fetch-model`).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { TfScorer } from "../src/scorer.js";
import { ATTRIBUTE_TO_LABEL } from "../src/mapping.js";

const MODEL_DIR = process.env.MODEL_DIR ?? "model";
const skip = existsSync(MODEL_DIR) ? false : "model not downloaded";
const scorer = new TfScorer();

before(async () => {
  if (!skip) await scorer.load(MODEL_DIR);
});

test("model exposes every mapped label", { skip }, () => {
  for (const label of Object.values(ATTRIBUTE_TO_LABEL)) {
    assert.ok(scorer.modelLabels.includes(label), `missing ${label}`);
  }
});

test("scores are probabilities", { skip }, async () => {
  const labels = Object.values(ATTRIBUTE_TO_LABEL);
  const scores = await scorer.score("hello there", labels);
  for (const l of labels) assert.ok(scores[l] >= 0 && scores[l] <= 1, `${l}=${scores[l]}`);
});

test("toxic text scores higher than benign text", { skip }, async () => {
  const benign = await scorer.score("Thanks for the thoughtful article.", ["toxicity"]);
  const toxic = await scorer.score("You are a stupid idiot.", ["toxicity"]);
  assert.ok(benign.toxicity < 0.2, `benign ${benign.toxicity}`);
  assert.ok(toxic.toxicity > 0.8, `toxic ${toxic.toxicity}`);
});
