// Downloads the toxicity model weights and USE vocabulary into ./model (or MODEL_DIR).
// Run once locally, and at image build time so weights are baked into the container.
// Each file is checked against scripts/model.sha256 when that file lists it.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MODEL_BASE = "https://tfhub.dev/tensorflow/tfjs-model/toxicity/1/default/1/";
const VOCAB_URL =
  "https://storage.googleapis.com/tfjs-models/savedmodel/universal_sentence_encoder/vocab.json";

const outDir = path.resolve(process.env.MODEL_DIR ?? "model");
const sumsFile = path.join(import.meta.dirname, "model.sha256");

async function loadSums(): Promise<Map<string, string>> {
  try {
    const text = await readFile(sumsFile, "utf8");
    return new Map(
      text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash, file] = line.trim().split(/\s+/);
          return [file, hash];
        }),
    );
  } catch {
    return new Map();
  }
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const sums = await loadSums();
const written: string[] = [];

async function save(rel: string, data: Buffer) {
  const hash = createHash("sha256").update(data).digest("hex");
  const expected = sums.get(rel);
  if (expected && expected !== hash) {
    throw new Error(`Checksum mismatch for ${rel}: expected ${expected}, got ${hash}`);
  }
  const dest = path.join(outDir, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, data);
  written.push(`${hash}  ${rel}`);
  console.log(`${expected ? "verified" : "UNVERIFIED"}  ${rel}`);
}

const modelJson = await download(`${MODEL_BASE}model.json?tfjs-format=file`);
await save("toxicity/model.json", modelJson);
const manifest = JSON.parse(modelJson.toString()) as {
  weightsManifest: Array<{ paths: string[] }>;
};
for (const p of manifest.weightsManifest.flatMap((g) => g.paths)) {
  await save(`toxicity/${p}`, await download(`${MODEL_BASE}${p}?tfjs-format=file`));
}
await save("vocab.json", await download(VOCAB_URL));

if (sums.size === 0) {
  await writeFile(sumsFile, written.join("\n") + "\n");
  console.log(`No checksums found; wrote ${path.relative(process.cwd(), sumsFile)}. Commit it.`);
}
