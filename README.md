# perspective-replacement

A drop-in replacement for the Perspective API endpoints that Coral calls, scored by the open TF.js toxicity model. See `../PLAN.md` for the full plan.

## Development

```sh
npm install
npm run dev        # run locally on :8080
npm test           # contract, golden and latency tests
npm run typecheck
```

## Status

Scaffold only. Dockerfile, `cloudbuild.yaml`, deploy details and Coral setup come in later milestones.
