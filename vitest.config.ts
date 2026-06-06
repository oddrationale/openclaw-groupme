import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: ["dist/**", "tests/**", "*.config.ts"],
      include: ["index.ts", "*.ts", "src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      thresholds: {
        branches: 55,
        functions: 60,
        lines: 70,
        statements: 70,
      },
    },
    include: ["tests/**/*.test.ts"],
  },
});
