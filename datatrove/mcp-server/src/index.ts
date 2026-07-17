import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { beginLogin, completeLogin, logout } from "./login.js";
import * as t from "./tools.js";
import { DEFAULT_STATE } from "./util.js";

// NOTE: this is a stdio MCP server — stdout carries the protocol. Never write to
// stdout (no console.log). Errors surface as tool results, not logs.

const STATE_PROP = {
  type: "string",
  enum: ["US-HI", "US-CA"],
  description: `Catalog state scope (US-HI = Hawaiʻi, US-CA = California). Defaults to ${DEFAULT_STATE}.`,
};

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any) => Promise<string>;
};

const TOOLS: ToolDef[] = [
  // ── Auth ──
  {
    name: "login",
    description:
      "Begin signing in to Datatrove. Opens a browser to approve access on datatrove.ai, then you MUST immediately call complete_login to finish. The result includes a URL to open manually if the browser didn't open.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => {
      const { authorizeUrl } = await beginLogin();
      return (
        "Open this URL in your browser and click Approve:\n" +
        `${authorizeUrl}\n\n` +
        "(A browser may have opened automatically.) After you Approve:\n" +
        "• Local machine: Claude Code finishes automatically — just call complete_login (no arguments).\n" +
        "• Remote / SSH / web session: the approval page shows a code — copy it and call complete_login with that code.\n\n" +
        "Tell the user to approve in the browser, then call complete_login."
      );
    },
  },
  {
    name: "complete_login",
    description:
      "Finish signing in to Datatrove after the user approved in the browser. Call right after the login tool. If the user pasted a code from the approval page (remote/SSH sessions), pass it as `code`; otherwise omit it to auto-detect the approval (local setups).",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The code shown on the approval page. Provide it when Claude Code didn't continue automatically (remote/SSH). Omit for local setups.",
        },
      },
      additionalProperties: false,
    },
    handler: async (a) => {
      const { email } = await completeLogin({ code: a.code });
      return `Signed in to Datatrove as ${email ?? "your account"}. You can now use the other Datatrove tools.`;
    },
  },
  {
    name: "logout",
    description: "Sign out of Datatrove: revoke this device's token server-side and delete the local credential.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => {
      const { wasLoggedIn } = await logout();
      return wasLoggedIn ? "Signed out — this connection has been revoked." : "You weren't signed in.";
    },
  },
  {
    name: "whoami",
    description: "Show the signed-in Datatrove account: email, plan, and remaining chat/analysis quota.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => t.whoami(),
  },
  // ── Catalog ──
  {
    name: "search_datasets",
    description:
      "Search the Datatrove catalog for datasets matching a natural-language query. Returns matches with source, coverage years, freshness, and verbatim source/download URLs. Always cite URLs exactly as returned.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search, e.g. 'California housing affordability'" },
        state: STATE_PROP,
        top_k: { type: "integer", description: "Max results (default 5)" },
        source: { type: "string", description: "Restrict to a single source id" },
        min_year: { type: "integer", description: "Only datasets whose coverage reaches this year or later" },
        freshness_min: { type: "number", description: "Minimum freshness score (0–100)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: (a) => t.searchDatasets(a.query, { state: a.state, top_k: a.top_k, source: a.source, min_year: a.min_year, freshness_min: a.freshness_min }),
  },
  {
    name: "list_sources",
    description: "List every Datatrove data source for a state with dataset/field counts and coverage years.",
    inputSchema: { type: "object", properties: { state: STATE_PROP }, additionalProperties: false },
    handler: (a) => t.listSources(a.state),
  },
  {
    name: "get_source",
    description: "Get one data source's datasets, quality issues, and stats by source id.",
    inputSchema: {
      type: "object",
      properties: { source_id: { type: "string" }, state: STATE_PROP },
      required: ["source_id"],
      additionalProperties: false,
    },
    handler: (a) => t.getSource(a.source_id, a.state),
  },
  {
    name: "get_dataset",
    description:
      "Get full metadata for one dataset by id: fields with sample values, coverage, license, and verbatim source/download URLs.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    handler: (a) => t.getDataset(a.id),
  },
  // ── Discovery + analyze ──
  {
    name: "discover",
    description:
      "Ask Datatrove's data-discovery chat where to find data for a question. Returns which datasets fit, how they combine, freshness caveats, and verbatim source/download URLs. If signed in, the turn is saved as a thread you can then analyze.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string" }, state: STATE_PROP },
      required: ["question"],
      additionalProperties: false,
    },
    handler: (a) => t.discover(a.question, a.state),
  },
  {
    name: "analyze",
    description:
      "Run a deep Datatrove analysis on a saved thread (from discover): it downloads the data, computes findings, and returns a narrative with Vega-Lite charts. Requires sign-in and a Pro plan. Long-running — may return 'still running' with a session id you poll via get_analysis.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "chat id from a prior discover call" },
        question: { type: "string", description: "Optional focus for the analysis; defaults to the thread's question" },
      },
      required: ["thread_id"],
      additionalProperties: false,
    },
    handler: (a) => t.analyze(a.thread_id, a.question),
  },
  {
    name: "get_analysis",
    description: "Check the status or fetch the result of a running analysis by session id.",
    inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"], additionalProperties: false },
    handler: (a) => t.getAnalysis(a.session_id),
  },
  // ── Threads ──
  {
    name: "list_my_threads",
    description: "List the signed-in user's saved Datatrove conversation threads for a state.",
    inputSchema: { type: "object", properties: { state: STATE_PROP }, additionalProperties: false },
    handler: (a) => t.listMyThreads(a.state),
  },
  {
    name: "get_thread",
    description: "Get one of the user's saved threads (messages + any analyses) by chat id.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    handler: (a) => t.getThread(a.id),
  },
  // ── Gallery (public) ──
  {
    name: "browse_gallery",
    description: "Browse public example Datatrove threads (the Gallery) for a state.",
    inputSchema: {
      type: "object",
      properties: { state: STATE_PROP, sort: { type: "string" }, limit: { type: "integer" }, before: { type: "string", description: "ISO-8601 cursor for pagination" } },
      additionalProperties: false,
    },
    handler: (a) => t.browseGallery({ state: a.state, sort: a.sort, limit: a.limit, before: a.before }),
  },
  {
    name: "get_public_thread",
    description: "Read one public Gallery thread (messages + charts) by id.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    handler: (a) => t.getPublicThread(a.id),
  },
];

const server = new Server({ name: "datatrove", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((x) => x.name === req.params.name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }], isError: true };
  }
  try {
    const text = await tool.handler(req.params.arguments ?? {});
    return { content: [{ type: "text", text }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
