// HTTP routes and API-key check. See PLAN.md "Architecture" and "API contract".
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8080);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    // TODO: return 503 until the model has loaded.
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"status":"ok"}');
    return;
  }
  // TODO: POST /v1alpha1/comments:analyze and /v1alpha1/comments:suggestscore
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: 404, message: "Not found" } }));
});

server.listen(port, () => {
  // Never log the query string or comment text.
  console.log(JSON.stringify({ event: "listening", port }));
});
