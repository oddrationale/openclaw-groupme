# Plugin ID Mismatch Warning: `groupme` vs `openclaw-groupme`

## Summary

When the `openclaw-groupme` plugin is loaded, OpenClaw emits a config warning:

```
plugin groupme: plugin id mismatch (manifest uses "groupme", entry hints "openclaw-groupme")
```

This warning is **benign** — the plugin loads and functions correctly. It is a cosmetic issue caused by a tension between two different conventions for plugin ID naming: one used internally by the plugin (`groupme`) and one inferred by OpenClaw from the npm package name (`openclaw-groupme`). The warning cannot be resolved on the plugin side without either re-introducing a prior regression or waiting for OpenClaw to expose a configuration mechanism for suppressing it.

---

## Background

### What the warning means

OpenClaw determines a plugin's "entry hint" ID from the key used in the `plugins.entries` config (or, when auto-discovered, from the npm package name). In this case, the npm package is named `openclaw-groupme`, so OpenClaw strips the `openclaw-` prefix and arrives at `openclaw-groupme` as the inferred ID.

The plugin's own manifest — set in `openclaw.plugin.json`, `package.json#openclaw.channel.id`, and `index.ts` — declares the ID as `groupme`.

These two values don't match, so OpenClaw logs a warning.

### History: the back-and-forth

This issue has already gone through one full attempt at a fix that had to be reverted:

1. **[#24](https://github.com/oddrationale/openclaw-groupme/issues/24)** — Identified the mismatch; proposed changing the plugin ID from `groupme` to `openclaw-groupme` to align with what OpenClaw infers from the package name.

2. **[#25](https://github.com/oddrationale/openclaw-groupme/commits/99bf57adb329ec3ce7c78a03830b6bf7f830c739)** — Implemented the fix: changed the manifest `id` field to `openclaw-groupme` in `openclaw.plugin.json` and `index.ts`.

3. **[#27](https://github.com/oddrationale/openclaw-groupme/commits/dca67552a2fc9fc58231e9b7b24a7c1d191fc062)** — Reverted the fix. The change to `openclaw-groupme` broke compatibility with `openclaw doctor` and with existing user configs that reference the plugin by the `groupme` short-form ID. Existing installations broke silently because their `plugins.entries.groupme` key no longer matched the plugin's declared ID.

The revert commit message reads: _"revert plugin id to 'groupme' to align with openclaw doctor"_.

The current state (`id: "groupme"` in the manifest) is the stable, intentional configuration. The warning is a known consequence.

---

## Root Cause

The conflict stems from two overlapping but inconsistent identification schemes:

| Layer | Value | Set by |
|---|---|---|
| npm package name | `openclaw-groupme` | `package.json#name` |
| OpenClaw inferred hint | `openclaw-groupme` | Derived by OpenClaw from package name |
| Plugin manifest ID | `groupme` | `openclaw.plugin.json`, `index.ts`, `package.json#openclaw.channel.id` |
| `openclaw doctor` expected ID | `groupme` | Hardcoded in OpenClaw's doctor checks |
| User config key | `groupme` | `plugins.entries.groupme` in user's OpenClaw config |

OpenClaw uses the npm package name convention (`openclaw-<channel>`) as the "hint" for what the plugin ID should be, but the plugin itself uses just the short channel name (`groupme`). There is currently no mechanism in the OpenClaw plugin SDK to declare the npm package name separately from the plugin's logical ID, nor a way to suppress or acknowledge this specific mismatch.

### Why the "obvious fix" doesn't work

Renaming the plugin ID to `openclaw-groupme` (the hint value) resolves the warning, but causes a cascade of other problems:

- `openclaw doctor` checks for the `groupme` plugin ID and would flag it as missing or misconfigured.
- Users who have already configured the plugin with `plugins.entries.groupme` (the standard post-install key) would hit broken configs.
- Any OpenClaw internals that reference the channel by the `groupme` ID (e.g., channel routing, `openclaw channels status`) would break.

There is no way to simultaneously satisfy the inferred hint (`openclaw-groupme`) and the expected logical ID (`groupme`) without a change on OpenClaw's side.

---

## Impact

- **Functional impact:** None. The plugin loads, registers the GroupMe channel, and handles webhooks correctly.
- **Visual noise:** The warning appears in `openclaw plugins list` output and in gateway logs on startup.
- **User confusion:** New users may see the warning and assume something is misconfigured. It is not.

---

## The Fix Belongs in OpenClaw

The correct resolution requires a change to OpenClaw's plugin loader, not to this plugin. Specifically, one of the following approaches would resolve it:

### Option A: Explicit package name declaration

Allow plugins to declare their npm package name separately from their logical ID in `openclaw.plugin.json` or `package.json#openclaw`:

```json
{
  "id": "groupme",
  "packageName": "openclaw-groupme"
}
```

OpenClaw would use `packageName` to match against the npm entry, resolving the hint without requiring the `id` to change.

### Option B: Suppress/acknowledge mechanism

Allow plugins to suppress known benign mismatches via a field in their manifest:

```json
{
  "id": "groupme",
  "entryHintOverride": "openclaw-groupme"
}
```

This would tell OpenClaw: "yes, we know the hint says `openclaw-groupme`; the correct ID is still `groupme`."

### Option C: Strip the full `openclaw-` prefix consistently

OpenClaw already strips the `openclaw-` prefix when deriving the hint (i.e., `openclaw-groupme` → `openclaw-groupme`, not just `groupme`). If it stripped the full `openclaw-` prefix to produce just `groupme`, the hint and the manifest ID would match automatically. This would be the lowest-effort fix on the OpenClaw side and would apply to any plugin following the `openclaw-<channel>` naming convention.

---

## Current Workaround

There is no workaround available on the plugin side that doesn't introduce a regression.

Users seeing the warning can safely ignore it. To verify the plugin is working correctly despite the warning:

```bash
openclaw plugins list
openclaw channels status --probe
```

The plugin status should show as `loaded` and the channel should be functional.

---

## References

- Commit where `groupme` → `openclaw-groupme` was attempted: [`99bf57a`](https://github.com/oddrationale/openclaw-groupme/commit/99bf57adb329ec3ce7c78a03830b6bf7f830c739)
- Commit reverting back to `groupme`: [`dca6755`](https://github.com/oddrationale/openclaw-groupme/commit/dca67552a2fc9fc58231e9b7b24a7c1d191fc062)
- Related CHANGELOG entry: [v0.3.0 Bug Fixes](../CHANGELOG.md)
- Plugin manifest: [`openclaw.plugin.json`](../openclaw.plugin.json)
- Plugin entry: [`index.ts`](../index.ts)
