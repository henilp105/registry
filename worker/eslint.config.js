// Flat ESLint config. Type-aware linting is deliberately off: the Workers
// runtime types come from @cloudflare/workers-types, and enabling a project
// service would pull Node type definitions into a runtime that has no Node.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      // Cloudflare Workers run on ES2022+ with WebCrypto and no Node globals
      // beyond what nodejs_compat polyfills, so `process` is not available.
      "no-console": "off",
      eqeqeq: ["error", "smart"],
      "no-implicit-coercion": "off",
    },
  },
);
