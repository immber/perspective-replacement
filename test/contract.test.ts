import { test } from "node:test";
import assert from "node:assert/strict";
import { isEnglish } from "../src/language.ts";
import { ATTRIBUTE_TO_LABEL } from "../src/mapping.ts";

test("english check accepts en and en-US", () => {
  assert.equal(isEnglish(["en"]), true);
  assert.equal(isEnglish(["en-US"]), true);
  assert.equal(isEnglish(["fr"]), false);
});

test("mapping covers TOXICITY", () => {
  assert.equal(ATTRIBUTE_TO_LABEL.TOXICITY, "toxicity");
});

test.todo("analyze returns 403 for a missing or wrong key");
test.todo("analyze returns 400 for empty text, unsupported attribute, non-English");
test.todo("analyze response matches Perspective shape");
test.todo("suggestscore returns 200 and stores nothing");
