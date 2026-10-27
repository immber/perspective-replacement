// TF.js toxicity model loading and scoring.
// Inference logic ported from @tensorflow-models/toxicity 1.2.2 (Apache-2.0, Google LLC).
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as tf from "@tensorflow/tfjs-node";
import { ATTRIBUTE_TO_LABEL, type Label } from "./mapping.js";
import { Tokenizer, type Vocabulary } from "./tokenizer.js";

export interface Scorer {
  /** True once the model is loaded and requests can be scored. */
  isReady(): boolean;
  /** Probability (0 to 1) for each requested label. */
  score(text: string, labels: Label[]): Promise<Record<Label, number>>;
}

export class TfScorer implements Scorer {
  private model?: tf.GraphModel;
  private tokenizer?: Tokenizer;
  /** Output node name for each label, read from the model itself. */
  private heads = new Map<string, string>();

  /** Labels the loaded model actually exposes. */
  get modelLabels(): string[] {
    return [...this.heads.keys()];
  }

  /** Load weights and vocabulary from `modelDir` (see scripts/fetch-model.ts). */
  async load(modelDir: string): Promise<void> {
    const dir = path.resolve(modelDir);
    const [model, vocab] = await Promise.all([
      tf.loadGraphModel(`file://${path.join(dir, "toxicity", "model.json")}`),
      readFile(path.join(dir, "vocab.json"), "utf8"),
    ]);
    for (const o of model.outputs) this.heads.set(o.name.split("/")[0], o.name);

    const missing = Object.values(ATTRIBUTE_TO_LABEL).filter((l) => !this.heads.has(l));
    if (missing.length > 0) {
      throw new Error(
        `Model is missing labels ${missing.join(", ")}; it has ${this.modelLabels.join(", ")}`,
      );
    }

    this.tokenizer = new Tokenizer(JSON.parse(vocab) as Vocabulary);
    this.model = model;
  }

  isReady(): boolean {
    return this.model !== undefined;
  }

  async score(text: string, labels: Label[]): Promise<Record<Label, number>> {
    if (!this.model || !this.tokenizer) throw new Error("Model not loaded");

    const ids = this.tokenizer.encode(text);
    const indices = tf.tensor2d(
      ids.map((_, i) => [0, i]),
      [ids.length, 2],
      "int32",
    );
    const values = tf.tensor1d(ids, "int32");
    let outputs: tf.Tensor[] = [];
    let combined: tf.Tensor | undefined;
    try {
      // Asking only for the requested heads lets tfjs skip the others.
      const result = await this.model.executeAsync(
        { Placeholder_1: indices, Placeholder: values },
        labels.map((l) => this.heads.get(l)!),
      );
      outputs = Array.isArray(result) ? result : [result];
      // Each head returns [p(not label), p(label)]; read them all in one transfer.
      combined = tf.tidy(() => tf.concat(outputs.map((t) => t.reshape([-1]))));
      const probs = await combined.data();
      const scores = {} as Record<Label, number>;
      labels.forEach((label, i) => {
        scores[label] = probs[i * 2 + 1];
      });
      return scores;
    } finally {
      indices.dispose();
      values.dispose();
      tf.dispose(outputs);
      combined?.dispose();
    }
  }
}
