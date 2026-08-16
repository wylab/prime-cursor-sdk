#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { closeSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const prime = process.env.PRIME_AGENT_BIN ?? "prime-agent";
const tempRoot = await mkdtemp(join(tmpdir(), "prime-cursor-sdk-package-smoke-"));
const project = join(tempRoot, "project");
const packDir = join(tempRoot, "pack");
await mkdir(project, { recursive: true });
await mkdir(packDir, { recursive: true });
const smokeEnv = {
  ...process.env,
  PRIME_AGENT_TELEMETRY: "0",
};
delete smokeEnv.PRIME_AGENT_CODING_AGENT_DIR;
delete smokeEnv.CURSOR_API_KEY;
for (const key of Object.keys(smokeEnv)) {
  if (key.toLowerCase().startsWith("npm_config_")) delete smokeEnv[key];
}

function formatFailure(error) {
  const stdout = error?.stdout ?? "";
  const stderr = error?.stderr ?? "";
  return [stdout, stderr].filter(Boolean).join("\n");
}

try {
  const { stdout } = await exec("npm", ["pack", "--ignore-scripts", "--pack-destination", packDir, "--json"], { cwd: root });
  const entries = JSON.parse(stdout);
  const entry = Array.isArray(entries) ? entries[0] : Object.values(entries)[0];
  const fileName = entry?.filename;
  if (typeof fileName !== "string" || !fileName.endsWith(".tgz")) {
    throw new Error("npm pack did not return a tarball filename");
  }
  const tarball = join(packDir, fileName);
  const source = `npm:prime-cursor-sdk@${pathToFileURL(tarball).href}`;

  await exec(prime, ["package", "install", source, "--local"], {
    cwd: project,
    env: smokeEnv,
  });

  const outputPath = join(tempRoot, "prime-output.jsonl");
  const outputFd = openSync(outputPath, "w");
  const args = [
    "--no-session",
    "--mode",
    "json",
    "--no-context-files",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--provider",
    "cursor",
    "--model",
    "cursor/auto",
    "-p",
    "Reply with exactly PRIME_CURSOR_SDK_PACKAGE_SMOKE.",
  ];
  const result = await new Promise((resolveResult, rejectResult) => {
    const child = spawn(prime, args, { cwd: project, env: smokeEnv, stdio: ["ignore", outputFd, "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGTERM"), 90_000);
    child.once("error", rejectResult);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolveResult({ code, signal, stderr });
    });
  });
  closeSync(outputFd);
  if (result.code !== 0) throw new Error(`Prime package smoke exited with ${result.code ?? result.signal}: ${result.stderr}`);
  const records = (await readFile(outputPath, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const assistant = records.find((record) =>
    record.type === "message_start" &&
    record.message?.role === "assistant" &&
    record.message?.api === "cursor-sdk" &&
    record.message?.provider === "cursor",
  );
  const extensionErrors = records.filter((record) => record.type === "extension_error");
  if (!assistant || extensionErrors.length > 0) {
    throw new Error("Prime did not load the packed Cursor SDK provider");
  }
  console.log("Prime Cursor SDK packed-package smoke passed (api=cursor-sdk, provider=cursor)");
} catch (error) {
  const details = formatFailure(error);
  if (details) process.stderr.write(details);
  throw error;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
