// TF.js toxicity model loading and scoring.
// The real model (vendored loader + tfjs-node) is not implemented yet; the
// server depends only on this interface so tests can use a fake.
import type { Label } from "./mapping.js";

export interface Scorer {
  /** True once the model is loaded and requests can be scored. */
  isReady(): boolean;
  /** Probability (0 to 1) for each requested label. */
  score(text: string, labels: Label[]): Promise<Record<Label, number>>;
}
