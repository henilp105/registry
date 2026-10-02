/**
 * Minimal static server with SPA fallback, for local verification.
 *
 *   node scripts/serve_build.cjs frontend/build 5173
 *
 * Exists because the archives page and every React Router path need index.html
 * to be served for unknown routes, and because `npx serve` was not available in
 * the verification environment. No dependencies, on purpose: this is a test
 * harness, not part of the application.
 */
const http = require("http"), fs = require("fs"), path = require("path");
const root = process.argv[2], port = Number(process.argv[3] || 5173);
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
  ".json":"application/json", ".png":"image/png", ".jpg":"image/jpeg",
  ".svg":"image/svg+xml", ".ico":"image/x-icon", ".woff2":"font/woff2", ".map":"application/json" };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(root, url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // SPA fallback: React Router owns every unmatched path.
    file = path.join(root, "index.html");
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-store" });
  res.end(body);
}).listen(port, "127.0.0.1", () => console.log("serving", root, "on", port));
