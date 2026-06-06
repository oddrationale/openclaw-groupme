# Contributing

Thanks for helping improve `openclaw-groupme`.

## Setup

Use Node.js 18 or newer. The CI matrix currently checks Node 18, 20, 22, and 24.

```bash
npm ci
```

The install step runs `lefthook install`, which wires local Git hooks for formatting, commit message checks, and pre-push verification.

## Daily Workflow

Run the full local gate before pushing:

```bash
npm run check
```

That runs:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run knip`

Useful focused commands:

```bash
npm run lint
npm run lint:fix
npm run format
npm run typecheck
npm test
npm run test:coverage
npm run test:watch
npm run build
npx vitest run tests/parse.test.ts
npx vitest run -t "accepts active"
```

## Code Style

Biome owns formatting and linting. Prefer `npm run lint:fix` for safe automatic fixes. Keep TypeScript strict and avoid adding compatibility shims unless the current OpenClaw release requires them.

Pull requests also run autofix.ci. If Biome can safely repair formatting or import-order drift, autofix.ci pushes those fixes back to the PR branch.

All imports use `.js` extensions because the package uses Node16 module resolution.

## Configuration And Secrets

Assume OpenClaw `v2026.6.1` or newer. The plugin config should stay explicit and modern:

- Keep sensitive values as OpenClaw secret inputs where possible.
- Do not reintroduce implicit `process.env` fallback in runtime account resolution.
- Keep `webhookPath` and `callbackToken` separate; do not merge them back into a single callback URL config field.

## GroupMe API References

Local GroupMe reference docs live in `docs/references/`. Use them when changing API integration code:

- `docs/references/groupme-api-reference.md`
- `docs/references/groupme-image-service-reference.md`
- `docs/references/groupme-bot-tutorial.md`

## Commits

Use Conventional Commits:

```text
feat: add group directory lookup
fix: reject invalid callback tokens
docs: update setup guide
test: cover webhook replay cache
chore: update dev tooling
```

Release Please uses commit types to determine release notes and version bumps. `feat:` and `fix:` affect releases; docs, tests, CI, and chores do not.

## Packaging

Before publishing or validating a package, run:

```bash
npm pack --dry-run
```

The package must include `openclaw.plugin.json`, compiled runtime files under `dist/`, and the TypeScript source files listed in `package.json#files`.
