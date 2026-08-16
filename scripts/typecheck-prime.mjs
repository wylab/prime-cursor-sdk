import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const primeRoot = process.env.PRIME_AGENT_ROOT ?? join(globalRoot, "prime-agent");
const primeIndex = join(primeRoot, "dist", "index.d.ts");
const primeAi = join(primeRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "index.d.ts");
const primeTui = join(primeRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "index.d.ts");
for (const path of [primeIndex, primeAi, primeTui]) {
	if (!existsSync(path)) throw new Error(`Prime Agent type declarations not found: ${path}`);
}

const tempRoot = mkdtempSync(join(tmpdir(), "prime-cursor-sdk-typecheck-"));
const configPath = join(tempRoot, "tsconfig.json");
writeFileSync(configPath, JSON.stringify({
	extends: join(root, "tsconfig.json"),
	compilerOptions: {
		baseUrl: root,
		paths: {
			"@earendil-works/pi-coding-agent": [primeIndex],
			"@earendil-works/pi-ai": [primeAi],
			"@earendil-works/pi-tui": [primeTui],
		},
		ignoreDeprecations: "6.0",
		noEmit: true,
	},
	include: [join(root, "src")],
}, null, 2));

try {
	const tsc = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
	const result = spawnSync(tsc, ["-p", configPath, "--pretty", "false"], { cwd: root, stdio: "inherit" });
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}
