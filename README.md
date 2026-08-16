# prime-cursor-sdk

A Prime Agent provider backed by the official [`@cursor/sdk`](https://www.npmjs.com/package/@cursor/sdk). It exposes Cursor local and cloud agents through the `cursor` provider without invoking the Cursor Agent CLI.

This repository is a Prime Agent adapter of the complete `pi-cursor-sdk` implementation. The SDK model catalog, streaming, thinking events, sessions, tool bridge, cancellation, local resume, and cloud handoff remain in `src/`; `src/prime-index.ts` supplies the Prime-specific entry point.

## Install in Prime Agent

After publishing or installing the package from npm:

```sh
prime-agent package install npm:prime-cursor-sdk
```

For a local packed tarball, use an explicit npm file spec (a bare `.tgz` is treated as an extension path by Prime):

```sh
prime-agent package install npm:prime-cursor-sdk@file:/absolute/path/prime-cursor-sdk-0.1.0.tgz
```

Remove the CLI-based Cursor provider if it is installed, because both packages register `cursor`:

```sh
prime-agent package remove npm:@netandreus/pi-cursor-provider
```

The adapter also calls `unregisterProvider("cursor")` before registration, so a stale CLI provider cannot win provider precedence during startup.

## Authentication

Use the Cursor SDK authentication supported by your installation. Prime reads a stored `cursor` API-key credential from `~/.prime/agent/auth.json` through `AuthStorage`; `CURSOR_API_KEY` is also supported for non-interactive runs. Prime Agent stores its extension state under `~/.prime/agent`.

Project Cursor configuration is stored at `.prime/agent/cursor-sdk.json`. Prime 0.7.2 has no project-trust API, so this file is ignored by default. To explicitly approve project configuration for one process, set `PRIME_AGENT_PROJECT_TRUSTED=1`; never set it for untrusted checkouts.

## Usage

```sh
prime-agent --provider cursor --model cursor/auto
prime-agent --provider cursor --model cursor/composer-2
```

The provider uses `api: "cursor-sdk"` and discovers the live Cursor model catalog at startup. Model discovery failures are reported by the extension rather than silently falling back to the Cursor CLI provider.

The complete Cursor SDK controls are available as Prime commands, including `/cursor-mode`, `/cursor-runtime`, `/cursor-tools`, `/cursor-refresh-models`, and `/cursor-refresh-config`. Use `prime-agent --help` for host options.

## Prime compatibility

Prime Agent intentionally preserves the inherited Pi extension API aliases used by the upstream implementation. The adapter avoids Pi-only `CONFIG_DIR_NAME` and resolves project configuration from the active host: `.prime/agent` for Prime and `.pi` for Pi-compatible test hosts.

Prime's structured extension context does not expose the Pi `mode` field or Pi native tool-definition factories. Consequently, native replay-tool registration remains opt-in and is not activated by default in Prime; Cursor SDK tool events and the regular SDK bridge continue to work. Provider streaming, thinking, sessions, model discovery, and cancellation do not depend on those factories.

## Development

```sh
npm install
npm run typecheck:src
npm run build
npm test
```

Run an isolated Prime smoke test against the compiled adapter (requires a configured Cursor credential):

```sh
npm run build
node scripts/prime-smoke.mjs
```

The smoke test uses a temporary Prime agent directory and verifies JSONL output reports `api: "cursor-sdk"` and `provider: "cursor"`.

Validate the published shape by packing and installing a fresh tarball into a temporary project-local Prime package set:

```sh
npm run prime:package-smoke
```

## Credits

The SDK implementation originated in [`fitchmultz/pi-cursor-sdk`](https://github.com/fitchmultz/pi-cursor-sdk). This fork keeps its MIT license and attribution while adding the Prime Agent entry point and host compatibility layer.
