# Datatrove plugin for Claude Code

Discover and analyze U.S. public data with [Datatrove](https://datatrove.ai) directly from Claude Code. After a one-time browser sign-in, you (and Claude, agentically) can run data-discovery chat, request deep analyses, browse your saved threads and the public gallery, and query the source catalog — handy when you're working on your own data locally and want to fold in public datasets.

## Requires a Datatrove Pro account

The plugin is available on **Pro** and **Admin** accounts. Free accounts can use
datatrove.ai in the browser, but `/datatrove:login` will decline with a link to
[plans](https://datatrove.ai/upgrade).

Pro gets the plugin its **own daily allowance**, separate from the web app —
plugin sessions are bursty, so the plugin budget is more generous than the web
one, and the two do not eat each other. A combined monthly ceiling applies
across both surfaces. Current numbers are always live at
`https://api.datatrove.ai/api/plans`; at time of writing:

| | web app | this plugin | combined ceiling |
|---|---|---|---|
| Pro chat | 100/day | **250/day** | 500/month |
| Analyses | 25/month, shared across both surfaces | | |

Admin accounts are unlimited.

## Commands

| Command | What it does |
|---|---|
| `/datatrove:login` | Connect your Datatrove account (opens a browser to approve) |
| `/datatrove:logout` | Disconnect this device |
| `/datatrove:ask <question>` | Data-discovery chat — where to find data for a question |
| `/datatrove:analyze <thread-id>` | Run a deep analysis (findings + charts) on a saved thread (Pro) |
| `/datatrove:mythreads` | List / open your saved conversation threads |
| `/datatrove:sources [id or terms]` | Browse the data-source catalog and search datasets |
| `/datatrove:gallery` | Browse public example threads |

Claude can also use the underlying tools on its own — e.g. "find California housing data and analyze the trend" will chain discovery → analysis.

## Install

```
/plugin install datatrove@kahidreamers-marketplace
```

For local development against a checkout of this repo instead:

```bash
claude --plugin-dir ./datatrove
```

Then in Claude Code run `/datatrove:login` and approve in the browser.

- **Local machine:** sign-in completes automatically after you click Approve.
- **Remote / SSH / web session:** the browser can't reach Claude Code's loopback, so the approval page shows a **code** — copy it and paste it back when Claude asks (it calls `complete_login` with the code).

Revoke anytime with `/datatrove:logout`, from your Datatrove account settings, or by deleting the cached credential (below).

## Configuration (optional env vars)

| Var | Default | Purpose |
|---|---|---|
| `DATATROVE_STATE` | `US-HI` | Home state scope for the catalog (`US-HI` or `US-CA`). Tools also accept a per-call `state`. |
| `DATATROVE_API_URL` | `https://api.datatrove.ai` | API base (override for local dev) |
| `DATATROVE_WEB_URL` | `https://datatrove.ai` | Web base for the sign-in page |

The credential is stored at `${CLAUDE_PLUGIN_DATA}/credentials.json` (mode `600`), or `~/.datatrove/credentials.json` outside the plugin runtime.

## Developing

The MCP server is a small stdio server that wraps Datatrove's REST API. Edit `mcp-server/src/`, then rebuild the single-file bundle (`mcp-server/dist/index.js`, committed so users need no build step):

```bash
cd mcp-server
npm install
npm run build      # esbuild → dist/index.js
npx tsc --noEmit   # typecheck
```
