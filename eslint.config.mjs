import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next_build_backup_*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Non-Next sub-projects and tooling — each has its own runtime/config and
    // was never meant to satisfy the Next.js app's lint profile:
    "workflows/**",            // n8n-as-code sync directory (generated TS)
    "restaurantiq-backend/**", // separate NestJS service
    "scripts/**",              // CJS build/ops tooling
  ]),
  {
    // Pre-existing debt across the app is tracked as warnings so CI can gate on
    // NEW errors without being permanently red. Tighten back to "error" per rule
    // as the backlog is cleared.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
]);

export default eslintConfig;
