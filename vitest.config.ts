import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    env: { NODE_ENV: "test" },
    include: ["tests/**/*.test.ts"],
    // Exclude live-browser integration tests from the default suite
    exclude: ["tests/**/*.integration.test.ts", "node_modules/**"],
    // Protocol + reliability tests hit a real browser — allow generous timeout
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
