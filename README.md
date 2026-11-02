# Clivra

A desktop chat client for **Claude Code**, **OpenAI Codex CLI** and **OpenCode**.
Clivra does not simulate AI: it drives the agents installed on your machine through their
official machine-readable interfaces and renders what they do — streamed text, reasoning,
tool calls, file diffs and permission prompts — in one calm, fast interface.

Electron · React 19 · TypeScript · Vite (electron-vite) · Tailwind 4 · Motion · xterm.js + node-pty · SQLite (`node:sqlite`, FTS5)

## How each provider is integrated

| Provider | Interface used | Models / effort | Permissions | Skills |
| --- | --- | --- | --- | --- |
| Claude Code | `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --permission-prompt-tool stdio` (the SDK control protocol) | Asked from the CLI itself (`initialize` control request): real model list and supported effort levels | `can_use_tool` requests are shown as approval cards; modes map to `--permission-mode` | Commands/agents listed from the CLI (read-only: Claude Code has no per-skill switch) |
| Codex CLI | `codex app-server` (JSONL JSON-RPC): `model/list`, `skills/list`, `thread/*`, `turn/*`, approval requests | `model/list` incl. `supportedReasoningEfforts` | `approvalPolicy` + `sandbox`; command/file approvals surfaced | Listed and toggled via `skills/config/write` |
| OpenCode | `opencode serve` (loopback, random port, password-protected): REST + SSE events | `/provider` (connected providers only); effort = model *variants* | Per-session permission rules; `permission.asked` surfaced | `/skill`; disabling = `skill` deny rules |

Everything the UI offers comes from those calls — there are no hard-coded model lists or fake responses.
Detection (`version`, auth, capability probes) is non-destructive and reported per provider on the **Providers** page,
including limitations a provider has (for example Codex has no native plan mode, so “Plan only” uses a read-only sandbox).

Provider **sessions are never shared**. Switching provider mid-conversation starts a new native session for that
provider and passes the earlier conversation as a clearly labelled transcript (a notice is shown in the chat).
Switching back resumes the original session.

## Architecture

```
src/shared     normalized event contract (NormalizedEvent → Block reducer), types, IPC surface
src/main       Electron main: providers/{claude,codex,opencode}.ts adapters, RunManager, SQLite store,
               process manager (no shell, process-group kill, orphan cleanup), node-pty terminals, git
src/preload    contextBridge API (contextIsolation, sandbox, no node in renderer)
src/renderer   React UI: virtualized chat, streaming markdown, diff viewer, composer, panels, settings
tests/         vitest (live CLI adapters, protocol, RunManager, core) + Playwright-for-Electron e2e
```

The renderer never parses provider output: adapters emit `NormalizedEvent`s (`text.delta`, `tool.start`,
`permission.request`, `file.change`, `run.completed`, …). The main process batches them per frame, reduces them
to blocks with the same reducer the renderer uses, and persists the assistant message while it streams.

Safety notes: children are spawned with argv arrays (never through a shell) and tracked so they are killed with
their process group on cancel/quit; IPC is origin-checked; CSP is strict; credentials are never read or stored by
Clivra (providers keep their own auth); OpenCode's local server is bound to loopback with a random password.

## Develop

```bash
npm install
npm run dev          # electron-vite dev server + app
npm run check        # tsc (main+web), eslint, vitest
npm run test:e2e     # builds, then drives the real app under Xvfb (Linux) against the installed CLIs
npm run build && npm start
```

Install the agents you want to use (`claude`, `codex`, `opencode`) and sign in to them; the Providers page shows exactly
what is missing and offers copy/“type in terminal” setup commands. Live tests skip any CLI that isn't installed.

## Status — what is verified and what is not

Verified on Linux (Electron 45, Node 24 runtime) against real binaries — Claude Code 2.1.316, Codex 0.166.0, OpenCode 1.19.5:

- Claude Code: live streaming, tool lifecycle, file diffs, permission **deny and allow** (file not written until approved), resume of the same native session, cancel of a running command, real model/effort/command listing — via vitest *and* through the real UI end-to-end.
- Codex: detection, real `model/list` / `skills/list`, auth failure handled without hanging. The run/approval/interrupt/crash handling is tested against a protocol stand-in (`tests/fixtures/fake-codex.mjs`) because no Codex account was available — **a real Codex turn has not been run**.
- OpenCode: detection, real connected-model and skill listing, a real run reaching the model layer (the free tier was exhausted in the test environment; the provider's “retry / upgrade” message is surfaced as a notice with its link) and cancel. A full successful OpenCode turn, and its permission prompts, have **not** been run end-to-end.
- Persistence, FTS search, settings, terminal (node-pty/xterm), command palette, restart recovery.

Not done / known gaps: packaged installers and auto-update (no update feed; Settings says so), Windows/macOS runs
(the code is written cross-platform, but only Linux was run), agent “question” prompts (declined with a notice),
multi-agent orchestration beyond independent concurrent conversations, and pasted-image attachments (file picker and
drag-and-drop work).
