import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cpus, freemem, machine, platform, release, totalmem, version } from "node:os";
import { join } from "node:path";

export interface EnvironmentMetadata {
  cpu: { model: string; logical_cores: number; arch: string };
  memory: { total_bytes: number; free_bytes: number };
  os: { platform: string; release: string; version: string; arch: string };
  bun: string;
  commit: string | null;
  code_hash: string;
}

async function commandOutput(command: string[], cwd: string): Promise<string | null> {
  try {
    const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "ignore" });
    if (await child.exited !== 0) return null;
    const output = await new Response(child.stdout).text();
    return output.trim() || null;
  } catch {
    return null;
  }
}

async function hashCode(root: string): Promise<string> {
  const files: string[] = [];
  for (const pattern of ["engine/**/*.ts", "eval/**/*.ts", "bench/**/*.ts", "server/**/*.ts", "neural/**/*.py", "web/**/*.{ts,tsx,js,jsx,css}"]) {
    for await (const path of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })) files.push(path);
  }
  files.sort();

  const digest = createHash("sha256");
  for (const path of files) {
    digest.update(`${path}\0`);
    digest.update(new Uint8Array(await Bun.file(join(root, path)).arrayBuffer()));
    digest.update("\0");
  }
  return digest.digest("hex");
}

export async function collectEnvironment(root: string): Promise<EnvironmentMetadata> {
  const processors = cpus();
  const arch = process.arch;
  return {
    cpu: { model: processors[0]?.model ?? machine(), logical_cores: processors.length, arch },
    memory: { total_bytes: totalmem(), free_bytes: freemem() },
    os: { platform: platform(), release: release(), version: version(), arch },
    bun: Bun.version,
    commit: await commandOutput(["git", "-C", root, "rev-parse", "HEAD"], root),
    code_hash: await hashCode(root),
  };
}

export function memoryUsage() {
  const memory = process.memoryUsage();
  return { rss_bytes: memory.rss, heap_used_bytes: memory.heapUsed, heap_total_bytes: memory.heapTotal };
}

export async function hashFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
