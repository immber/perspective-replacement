# Load test results: Google Cloud Run 

Results of load tests run with [k6](https://k6.io/) against a Google Cloud Run deployment. The goal was to find how much traffic one container can handle with a target response time of 800ms.

## Results Summary

- **One container (1 vCPU, 1 GiB) handles about 20 concurrent requests** within the latency target. The deploy command in the [README](README.md#deploy-to-google-cloud-run) sets `--concurrency=20` to this configuration.
- **CPU is the limit, not memory.** Each request runs the model once, and on one vCPU that work fills the core.
- **The current build increased capacity from about 15 to about 20 concurrent users.** It limits TensorFlow to one thread and includes a tokenizer fix. The tokenizer fix alone made little difference (run 3), so the thread setting is the likely cause for improvement.
- **More CPU helps only a little.** Going from 1 to 2 vCPU raised throughput by about 23%.
- **Less memory made things worse.** Dropping below 1 GiB lowered throughput.

## Latency target

Coral as an example client, waits 800 ms for a Perspective response by default (`PERSPECTIVE_TIMEOUT`). Test run pass criteria was determined for a given number of users when p99 latency stays under 800 ms.

## Test setup

| Setting | Value |
| --- | --- |
| Platform | Google Cloud Run, linux/amd64 |
| Instances | 1 (one container under test) |
| Load tool | k6, ramping virtual users |
| Endpoint | `POST /v1alpha1/comments:analyze` |

Comment samples: 
* 5 sample comments in config/payloads.json. Each request picks one at random.
* They cover a range of lengths and tones from 2 - 387 characters:
    * "ok" (2 characters)
    * a short thank-you (44)
    * an insult: "This is the dumbest thing I've read all week." (45)
    * a mild disagreement (87)
    * a long paragraph of product feedback (387)
* Each body is in English and asks for TOXICITY only

## Performance Results

- **Run:** 20261027_164855
- **Target:** /v1alpha1/comments:analyze
- **SLA:** p99 `< 800 ms`, errors `< 1.0%`
- **Overall:** p95 `2375.4 ms`, p99 `2761.4 ms`, error rate `1.14%`
- **First stage failing the SLA:** `50` VUs

| VUs | Requests | Success % | p50 ms | p95 ms | p99 ms | Max ms | TTFB p95 ms | RPS | SLA |
|----:|---------:|----------:|-------:|-------:|-------:|-------:|------------:|----:|:---:|
| 10 | 2684 | 100.00 | 212.0 | 286.0 | 366.6 | 1469.3 | 285.7 | 44.7 | PASS |
| 25 | 2683 | 100.00 | 556.6 | 719.8 | 793.7 | 837.9 | 719.5 | 44.7 | PASS |
| 50 | 2739 | 100.00 | 1144.8 | 1370.8 | 1464.7 | 1544.2 | 1370.6 | 45.6 | FAIL |
| 100 | 2934 | 100.00 | 2223.1 | 2491.0 | 3084.6 | 3196.0 | 2490.8 | 48.9 | FAIL |
| 250 | 563 | 76.55 | 1044.1 | 2735.3 | 2831.2 | 2892.7 | 2734.9 | 9.4 | FAIL |
| 500 | 0 | - | - | - | - | - | - | - | NOT RUN |

_Latency is `http_req_duration` (full response, includes laptop-to-target network time)._

_TTFB is `http_req_waiting`. RPS = requests / hold seconds._

## What we learned

1. **TensorFlow's thread count must match the container.** TensorFlow sizes its thread pools from the host machine's cores, not from the container's CPU limit. On a 1 vCPU container, the extra threads compete with Node for the one core. The image now sets `TF_NUM_INTRAOP_THREADS`, `TF_NUM_INTEROP_THREADS` and `OMP_NUM_THREADS` to 1. If you deploy with more vCPUs, set all three to the vCPU count.

1. **More CPU gives little gain.** tfjs runs the model one operation at a time, and one Node thread starts each operation. That thread also handles HTTP, JSON and tokenizing. A second vCPU speeds up the math inside each operation but not that single thread, so throughput rose by only about 23%.

1. **Memory should stay at 1 GiB.** With less memory, Node collects garbage more often, and that work runs on the same single vCPU. 

1. **Concurrency should match what one container can serve.** At 80, requests queue inside the container and latency climbs well past the target. At 20, Cloud Run sends extra requests to another instance instead, once more than one is allowed.

1. **Code changes to the tokenizer and score reading had little effect on short comments.** The tokenizer fix makes long comments (up to the 20 KB limit) about 3 times faster to tokenize, so it is kept. The scorer change (computing only the requested outputs and reading all scores at once) showed no gain and was reverted.

1. **Local timings don't predict Cloud Run timings.** One model call takes about 3.5 ms on a developer laptop, which uses many fast cores. On a 1 vCPU Cloud Run container, the same request costs roughly 10 times more CPU time.

## Opportunities for greater efficiency

- **Batch requests together:** score several waiting comments in one model call, so the fixed cost per call is shared.
- **Switch to ONNX Runtime:** it runs the whole model in native code, which removes most of the single-thread overhead. Scores must be checked against the current model.
