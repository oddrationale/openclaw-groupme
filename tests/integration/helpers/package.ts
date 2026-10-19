import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCliPath = process.env.npm_execpath;

let built = false;
let dryRun: PackDryRun | null = null;

export function run(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): string {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...options.env,
    },
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function buildPackage(): void {
  if (built) {
    return;
  }
  runNpm(["run", "build"]);
  pruneStaleBuildOutputs();
  built = true;
}

/**
 * `tsc` never deletes outputs, so JS left in dist/ by an older source layout
 * (for example removed sidecar entrypoints) would be packed too. Remove only
 * outputs whose `.ts` source no longer exists, so the contract tests see what a
 * clean CI/release build ships. Pruning after the build (instead of wiping dist/
 * first) never leaves current entrypoints missing for a concurrent packer.
 */
function pruneStaleBuildOutputs(): void {
  const distRoot = join(repoRoot, "dist");
  for (const entry of readdirSync(distRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      continue;
    }
    const output = join(entry.parentPath, entry.name);
    const source = join(repoRoot, relative(distRoot, output)).replace(/\.js$/, ".ts");
    if (!existsSync(source)) {
      rmSync(output, { force: true });
    }
  }
}

type PackedFile = {
  path: string;
  size: number;
  mode: number;
};

type PackDryRun = {
  filename: string;
  files: PackedFile[];
};

export function packDryRun(): PackDryRun {
  if (dryRun) {
    return dryRun;
  }
  buildPackage();
  const output = runNpm(["pack", "--dry-run", "--json"], {
    env: { npm_config_ignore_scripts: "true" },
  });
  const parsed = parseNpmJsonArray<PackDryRun>(output);
  const [pack] = parsed;
  if (!pack) {
    throw new Error("npm pack --dry-run returned no package entries");
  }
  dryRun = pack;
  return pack;
}

export function createTempProject(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTempProject(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export function packTarball(destination: string): string {
  buildPackage();
  const output = runNpm(["pack", "--json", "--pack-destination", destination], {
    env: { npm_config_ignore_scripts: "true" },
  });
  const parsed = parseNpmJsonArray<{ filename: string }>(output);
  const [pack] = parsed;
  if (!pack?.filename) {
    throw new Error("npm pack returned no tarball filename");
  }
  return join(destination, pack.filename);
}

function parseNpmJsonArray<T>(output: string): T[] {
  // npm prints --json output as an unindented block: an array up to npm 11, an
  // object keyed by package name from npm 12 (which openclaw now depends on, so
  // it can be the npm on PATH). Anchor on the block's own lines so text around
  // it is not swept into the parse.
  const match = /^(?:\[$[\s\S]*?^\]|\{$[\s\S]*?^\})$/m.exec(output);
  if (!match) {
    throw new Error(`Unable to find JSON output from npm: ${output}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch (error) {
    throw new Error(`Unable to parse JSON output from npm: ${output}`, { cause: error });
  }
  return (Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, T>)) as T[];
}

export function readRootPackageJson(): {
  files: string[];
  openclaw: {
    extensions: string[];
    setupEntry: string;
    compat: { pluginApi: string };
    build: { openclawVersion: string };
    install: {
      npmSpec: string;
      clawhubSpec: string;
      defaultChoice: string;
      minHostVersion: string;
    };
    startup?: unknown;
  };
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  engines: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
}

export async function importBuilt<T>(relativePath: string): Promise<T> {
  buildPackage();
  return import(pathToFileURL(join(repoRoot, relativePath)).href) as Promise<T>;
}

export function runNpm(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  if (npmCliPath) {
    return run(process.execPath, [npmCliPath, ...args], options);
  }
  return run(npmCommand, args, options);
}
