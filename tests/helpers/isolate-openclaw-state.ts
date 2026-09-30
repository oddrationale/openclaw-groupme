import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Real SDK helpers used in-process by the tests (for example the inbound envelope
// builder, which reads the session store) resolve the OpenClaw state directory
// from OPENCLAW_STATE_DIR or $HOME. Point it at a per-file temp dir so a test run
// never reads or writes the developer's real ~/.openclaw state. CLI smoke tests
// spawn OpenClaw with their own isolated HOME and clear this variable.
const stateDir = mkdtempSync(join(tmpdir(), "openclaw-groupme-state-"));
const previous = process.env.OPENCLAW_STATE_DIR;
process.env.OPENCLAW_STATE_DIR = stateDir;

afterAll(() => {
  if (previous === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = previous;
  }
  rmSync(stateDir, { recursive: true, force: true });
});
