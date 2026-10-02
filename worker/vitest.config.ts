import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // These suites exercise dependency-free modules (WebCrypto JWT, PBKDF2
    // hashing, validators, tokens) so they run in plain Node. Nothing here
    // imports a `cloudflare:*` binding, which is what keeps the feedback loop
    // fast — a full Workers pool would be overkill for pure functions.
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
