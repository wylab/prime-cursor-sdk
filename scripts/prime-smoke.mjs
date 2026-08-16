import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extension = resolve(root, "dist/prime-index.js");
const agentDir = await mkdtemp(resolve(tmpdir(), "prime-cursor-sdk-smoke-"));
const smokeEnv = { ...process.env, PRIME_AGENT_CODING_AGENT_DIR: agentDir, PI_CURSOR_NATIVE_TOOL_DISPLAY: "1" };
if (smokeEnv.CURSOR_API_KEY?.trim()) {
	await mkdir(agentDir, { recursive: true });
	await writeFile(resolve(agentDir, "auth.json"), JSON.stringify({ cursor: { type: "api_key", key: smokeEnv.CURSOR_API_KEY.trim() } }));
	delete smokeEnv.CURSOR_API_KEY;
}
const prime = process.env.PRIME_AGENT_BIN ?? "prime-agent";
const args = [
	"--offline",
	"--no-session",
	"--mode",
	"json",
	"--no-context-files",
	"--no-skills",
	"--no-prompt-templates",
	"--no-themes",
	"-e",
	extension,
	"--provider",
	"cursor",
	"--model",
	"cursor/auto",
	"-p",
	"Reply with exactly PRIME_CURSOR_SDK_SMOKE.",
];

try {
	const result = await new Promise((resolveResult, reject) => {
		const child = spawn(prime, args, {
			cwd: root,
			env: smokeEnv,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.on("error", reject);
		child.on("close", (code) => resolveResult({ code, stdout, stderr }));
	});

	const records = result.stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	const assistant = records.find((record) => record.type === "message_start" && record.message?.role === "assistant");
	const extensionErrors = records.filter((record) => record.type === "extension_error");
	if (result.code !== 0 || extensionErrors.length > 0 || assistant?.message?.api !== "cursor-sdk" || assistant?.message?.provider !== "cursor") {
		process.stderr.write(result.stderr);
		process.stderr.write(result.stdout);
		throw new Error("Prime smoke did not register the Cursor SDK provider");
	}

	console.log("Prime Cursor SDK smoke passed (api=cursor-sdk, provider=cursor)");
} finally {
	await rm(agentDir, { recursive: true, force: true });
}
