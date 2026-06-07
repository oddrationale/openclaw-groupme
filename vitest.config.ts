import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: ["dist/**", "tests/**", "*.config.ts"],
      include: ["index.ts", "*.ts", "src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      thresholds: {
        // Statements / functions / lines are held at 100%: any new untested code must be
        // a deliberate choice (cover it, or mark it with a documented `/* v8 ignore */`).
        statements: 100,
        functions: 100,
        lines: 100,
        // Branches floored at the achieved level. Every uncovered arm has been audited:
        // the remainder is legitimate trust-boundary defense (missing-field `?.`,
        // `?? default`, non-`Error` `instanceof` guards, `fetchFn ?? fetch`) whose untaken
        // side is unreachable or only reachable via contrived input. Raising this to 100
        // would mean many low-signal ignores rather than meaningful coverage.
        branches: 92,
      },
    },
    include: ["tests/**/*.test.ts"],
  },
});
