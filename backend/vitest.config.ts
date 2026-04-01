import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
