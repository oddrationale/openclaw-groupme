import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

export function buildPackage(): void {
  if (built) {
    return;
  }
  runNpm(["run", "build"]);
  built = true;
}

export type PackedFile = {
  path: string;
  size: number;
  mode: number;
};

export type PackDryRun = {
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
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new Error(`Unable to find JSON array in npm output: ${output}`);
  }
  return JSON.parse(output.slice(start, end + 1)) as T[];
}

export function readRootPackageJson(): {
  files: string[];
  openclaw: {
    extensions: string[];
    setupEntry: string;
    compat: { pluginApi: string };
  };
  peerDependencies: Record<string, string>;
  engines: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
}

export function assertExistsInRepo(relativePath: string): void {
  if (!existsSync(join(repoRoot, relativePath))) {
    throw new Error(`Expected ${relativePath} to exist in the repository`);
  }
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
