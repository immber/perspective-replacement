# perspective-replacement

A drop-in replacement for the [Perspective API](https://www.perspectiveapi.com/) endpoints that [Coral](https://github.com/coralproject/talk) calls. Comments are scored by the open TF.js toxicity model, so Coral installs keep working after Perspective shuts down on December 31, 2026.

- **English only** (v0). Other languages are rejected with a 400.
- **Nothing is stored.** Comment text is never written to disk, a database or logs.
- **Same request and response shape as Perspective** for the fields Coral uses.

## Quick start

Requires Node 22 or later.

```sh
npm install
npm run fetch-model                 # downloads ~28 MB of weights into ./model
PERSPECTIVE_API_KEY=dev-key npm run dev
```

```sh
curl -s -X POST "localhost:8080/v1alpha1/comments:analyze?key=dev-key" \
  -H 'content-type: application/json' \
  -d '{"comment":{"text":"You are a stupid idiot."},"requestedAttributes":{"TOXICITY":{}}}'
```

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PERSPECTIVE_API_KEY` | Yes | — | The key clients must send as `?key=`. The server exits at start if it is unset. |
| `PORT` | No | `8080` | Port to listen on. |
| `MODEL_DIR` | No | `model` | Folder holding the downloaded weights and vocabulary. |

## API

All endpoints accept and return JSON. Authenticated endpoints take the key as a query parameter, as Perspective does: `?key=<PERSPECTIVE_API_KEY>`.

### `POST /v1alpha1/comments:analyze`

Scores a comment for the requested attributes.

**Request**

```json
{
  "comment": { "text": "You are a stupid idiot." },
  "languages": ["en"],
  "requestedAttributes": { "TOXICITY": {}, "INSULT": {} },
  "doNotStore": true
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `comment.text` | Yes | Non-empty, up to 20,480 characters. |
| `requestedAttributes` | Yes | Object with at least one supported attribute as a key. Values are ignored. |
| `languages` | No | Must include an English code (`en`, `en-US`, …). If missing, the text is treated as English. |
| `doNotStore` | No | Accepted for compatibility. Nothing is ever stored. |

**Response (200)**

```json
{
  "attributeScores": {
    "TOXICITY": {
      "spanScores": [
        { "begin": 0, "end": 23, "score": { "value": 0.994, "type": "PROBABILITY" } }
      ],
      "summaryScore": { "value": 0.994, "type": "PROBABILITY" }
    }
  },
  "languages": ["en"],
  "detectedLanguages": ["en"]
}
```

Responses are pretty-printed with a trailing newline, as Perspective's are. Both language fields are always `["en"]` in v0. Scores are probabilities from 0 to 1. The model scores the whole comment, so there is always one span covering all of the text.

### `POST /v1alpha1/comments:suggestscore`

Accepts moderator feedback, which Coral sends when a comment is approved or rejected. The body must be a JSON object with a `comment` object. The service returns `200 {}` and discards the feedback.

### `GET /healthz`

No key required. Returns `200 {"status":"ok"}` when the model is loaded, and `503` otherwise. The server loads the model before it opens its port, so in practice a running server always answers 200.

### Supported attributes

| Perspective attribute | Model label |
| --- | --- |
| `TOXICITY` | `toxicity` |
| `SEVERE_TOXICITY` | `severe_toxicity` |
| `INSULT` | `insult` |
| `PROFANITY` | `obscene` |
| `THREAT` | `threat` |
| `IDENTITY_ATTACK` | `identity_attack` |
| `SEXUALLY_EXPLICIT` | `sexual_explicit` |

Requesting any other attribute returns a 400. Scores come from a different model than Perspective's, so they will not match Perspective numbers exactly, and thresholds may need adjusting.

### Errors

Every error has the same body, and `code` always equals the HTTP status:

```json
{ "error": { "code": 400, "message": "Unsupported attribute(s): FLIRTATION" } }
```

| Status | When |
| --- | --- |
| 400 | Malformed JSON, missing or empty text, text too long, no attributes, unsupported attribute, or non-English `languages` |
| 401 | `key` missing or empty |
| 403 | `key` wrong |
| 404 | Unknown route |
| 503 | Model not loaded yet |

## Using with Coral

In Coral's moderation settings, set the Perspective endpoint to `https://<your-host>/v1alpha1` and the API key to your `PERSPECTIVE_API_KEY`. Coral's request timeout defaults to 800 ms (`PERSPECTIVE_TIMEOUT`).

## Development

```sh
npm run dev          # run with reload on :8080
npm test             # all tests; model tests skip if ./model is missing
npm run typecheck
npm run build && npm start
```

`npm run fetch-model` checks every downloaded file against [scripts/model.sha256](scripts/model.sha256) and fails if any file has changed.

## Deploy to Cloud Run

The [Dockerfile](Dockerfile) builds a linux/amd64 image with the model weights baked in, verified against `scripts/model.sha256`. It runs as a non-root user and leaves out packages that tfjs-node only needs at install time. [cloudbuild.yaml](cloudbuild.yaml) builds the image and pushes it to Artifact Registry.

One-time setup (replace `REGION` with the region you choose, close to your Coral hosts):

```sh
gcloud artifacts repositories create perspective-replacement \
  --repository-format=docker --location=REGION
printf '%s' "$(openssl rand -hex 32)" | \
  gcloud secrets create perspective-api-key --data-file=-
```

Then grant the Cloud Run service account `roles/secretmanager.secretAccessor` on that secret.

Build, then deploy:

```sh
gcloud builds submit --config cloudbuild.yaml --substitutions=_REGION=REGION

gcloud run deploy perspective-replacement \
  --image=REGION-docker.pkg.dev/PROJECT_ID/perspective-replacement/perspective-replacement:latest \
  --region=REGION \
  --min-instances=1 --no-cpu-throttling \
  --memory=1Gi --cpu=1 \
  --set-secrets=PERSPECTIVE_API_KEY=perspective-api-key:latest \
  --allow-unauthenticated
```

- `--min-instances=1` and `--no-cpu-throttling` keep one instance warm, so requests never wait for a cold start.
- `--allow-unauthenticated` is needed because Coral sends our API key, not a Google identity token. The app checks the key itself.
- Memory is a first guess: the process uses about 500 MB locally. Concurrency and max instances should be set after load testing.

## Privacy and logging

- The service writes its own JSON log events only, never the query string (which holds the key) or comment text.
- Fastify's request logger is turned off because it records full URLs.
- On Cloud Run, the platform's request logs also record full URLs, including `?key=`. Exclude them in Cloud Logging (see `../PLAN.md`).

## Licence and attribution

The tokenizer and inference code is ported from Google's `@tensorflow-models/toxicity` and `@tensorflow-models/universal-sentence-encoder` (Apache-2.0). See [NOTICE](NOTICE).

## Status

Scoring works with the real model, and the image builds for Cloud Run. Still to come: golden and latency tests, the first deploy (service URL and region), and the Cloud Logging exclusion.
