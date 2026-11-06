import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/integration/**/*.test.ts"], testTimeout: 1_200_000, hookTimeout: 600_000, fileParallelism: false },
});
