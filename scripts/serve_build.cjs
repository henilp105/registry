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
const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 5173);
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
  ".json":"application/json", ".png":"image/png", ".jpg":"image/jpeg",
  ".svg":"image/svg+xml", ".ico":"image/x-icon", ".woff2":"font/woff2", ".map":"application/json" };
http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split("?")[0]);
  } catch {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("Bad request");
    return;
  }
  // Resolve against root and refuse anything that escapes it (path traversal).
  let file = path.resolve(root, "." + urlPath);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("Forbidden");
    return;
  }
  try {
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // SPA fallback: React Router owns every unmatched path.
      file = path.join(root, "index.html");
    }
    const body = fs.readFileSync(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log("serving", root, "on", port));
