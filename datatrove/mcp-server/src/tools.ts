import { api, API_URL, WEB_URL, loadCreds, requireState, ApiError } from "./util.js";

const j = (x: unknown): string => JSON.stringify(x, null, 2);

// ─── Auth / identity ────────────────────────────────────────────────────────
export async function whoami(): Promise<string> {
  const me = await api("/api/me", { auth: true });
  return j({
    email: me.email,
    plan: me.plan,
    isPro: me.isPro,
    analysesThisMonth: me.analysesThisMonth,
    analysesMonthCap: me.analysesMonthCap,
    chatMessagesToday: me.chatMessagesToday,
    chatMessagesDayCap: me.chatMessagesDayCap,
  });
}

// ─── Catalog (public; token sent if present, harmless) ──────────────────────
export async function listSources(state?: string): Promise<string> {
  const s = requireState(state);
  const data = await api(`/api/sources?state=${encodeURIComponent(s)}`);
  return j({
    state: s,
    sourceCount: data.sources?.length ?? 0,
    qualityIssueCount: data.qualityIssueCount,
    staleCopyCount: data.staleCopyCount,
    sources: data.sources,
  });
}

export async function getSource(sourceId: string, state?: string): Promise<string> {
  const s = requireState(state);
  return j(await api(`/api/sources/${encodeURIComponent(sourceId)}?state=${encodeURIComponent(s)}`));
}

export async function searchDatasets(
  q: string,
  opts: { state?: string; top_k?: number; source?: string; min_year?: number; freshness_min?: number } = {},
): Promise<string> {
  const s = requireState(opts.state);
  const params = new URLSearchParams({ q, state: s });
  if (opts.top_k) params.set("top_k", String(opts.top_k));
  if (opts.source) params.set("source", opts.source);
  if (opts.min_year) params.set("min_year", String(opts.min_year));
  if (opts.freshness_min != null) params.set("freshness_min", String(opts.freshness_min));
  const data = await api(`/api/search?${params.toString()}`);
  return j({ state: s, query: q, results: data.results });
}

export async function getDataset(id: string): Promise<string> {
  return j(await api(`/api/dataset/${encodeURIComponent(id)}`));
}

// ─── Threads (auth) ─────────────────────────────────────────────────────────
export async function listMyThreads(state?: string): Promise<string> {
  const s = requireState(state);
  const data = await api(`/api/chats`, { auth: true, state: s });
  return j({ state: s, chats: data.chats });
}

export async function getThread(id: string): Promise<string> {
  return j(await api(`/api/chats/${encodeURIComponent(id)}`, { auth: true }));
}

// ─── Gallery (public) ───────────────────────────────────────────────────────
export async function browseGallery(
  opts: { state?: string; sort?: string; limit?: number; before?: string } = {},
): Promise<string> {
  const s = requireState(opts.state);
  const params = new URLSearchParams({ state: s });
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.before) params.set("before", opts.before);
  return j(await api(`/api/public/gallery?${params.toString()}`));
}

export async function getPublicThread(id: string): Promise<string> {
  return j(await api(`/api/public/chat/${encodeURIComponent(id)}`));
}

// ─── Discovery chat (streaming NDJSON → composed answer) ─────────────────────
type DiscoverResult = { answer: string; datasets: Array<{ id: string; title: string; source: string }>; chatId: string | null };

function parseChatStream(raw: string): DiscoverResult {
  const lines = raw.split("\n");
  const datasets: DiscoverResult["datasets"] = [];
  let chatId: string | null = null;
  let answerStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("{")) {
      let ev: any = null;
      try { ev = JSON.parse(line); } catch { ev = null; }
      if (ev && typeof ev.type === "string") {
        if (ev.type === "chat_created") chatId = ev.id ?? null;
        else if (ev.type === "sources" && Array.isArray(ev.datasets)) datasets.push(...ev.datasets);
        else if (ev.type === "start") { answerStart = i + 1; break; }
        else if (ev.type === "error") throw new ApiError(500, "chat_error", ev.message || "chat stream error");
        continue;
      }
    }
  }
  let answer = answerStart >= 0 ? lines.slice(answerStart).join("\n") : raw;
  // Peel a trailing usage/error control line the answer text may carry.
  answer = answer.replace(/\n?\{"type":"(usage|error)"[\s\S]*\}\s*$/m, "").trim();
  return { answer, datasets, chatId };
}

export async function discover(question: string, state?: string): Promise<string> {
  const s = requireState(state);
  const creds = loadCreds();
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "text/plain", "X-Dt-State": s };
  if (creds) headers["Authorization"] = `Bearer ${creds.token}`;
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string; upgradeUrl?: string };
    if (b.error === "rate_limited" || b.error === "daily_limit_exceeded") {
      throw new ApiError(429, b.error, `Chat quota reached. ${creds ? "" : "Sign in with /datatrove:login for a higher limit, or "}try again later.`);
    }
    throw new ApiError(res.status, b.error || `http_${res.status}`, b.error || "discovery chat failed");
  }
  const parsed = parseChatStream(await res.text());
  const footer: string[] = [];
  if (parsed.datasets.length) {
    footer.push("\n\n---\nDatasets surfaced: " + parsed.datasets.map((d) => `${d.title} (${d.source}, id=${d.id})`).join("; "));
  }
  if (parsed.chatId) footer.push(`\nSaved to your Datatrove threads as chat ${parsed.chatId} — analyze it with the analyze tool or open ${WEB_URL}/?chat=${parsed.chatId}`);
  return parsed.answer + footer.join("");
}

// ─── Analyze (create durable run, poll to completion) ───────────────────────
function extractUrls(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s)"'\]]+/g) ?? [];
  return [...new Set(urls)].slice(0, 25);
}

export async function analyze(
  threadId: string,
  question: string | undefined,
  opts: { pollMs?: number; maxWaitMs?: number } = {},
): Promise<string> {
  // Build the analyze `context` from the thread's discovery answer.
  const thread = await api(`/api/chats/${encodeURIComponent(threadId)}`, { auth: true });
  const messages: Array<{ role: string; content: string }> = thread.messages ?? [];
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.content);
  const firstUser = messages.find((m) => m.role === "user");
  if (!lastAssistant) {
    throw new ApiError(400, "no_context", "That thread has no discovery result yet. Run a discovery chat on it first.");
  }
  const q = question || firstUser?.content || "Analyze the datasets in this thread.";
  const context = lastAssistant.content.slice(0, 12000);
  const datasetUrls = extractUrls(lastAssistant.content);

  const created = await api(`/api/analyze`, {
    method: "POST",
    auth: true,
    body: { chatId: threadId, question: q, context, datasetUrls },
  });
  const sessionId: string = created.sessionId;

  const pollMs = opts.pollMs ?? 5000;
  const maxWaitMs = opts.maxWaitMs ?? 180_000; // in-tool soft cap; runs can take up to ~15 min
  const started = Date.now();
  let last: any = null;
  while (Date.now() - started < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    last = await api(`/api/analyze/status?sessionId=${encodeURIComponent(sessionId)}`, { auth: true });
    if (last.status === "done" || last.status === "error") break;
  }
  if (last?.status === "done") {
    return `Analysis complete (session ${sessionId}).\n\n${last.content ?? "(no content)"}`;
  }
  if (last?.status === "error") {
    return `Analysis failed (session ${sessionId}): ${last.error ?? "unknown error"}`;
  }
  return j({
    status: "running",
    sessionId,
    note: `Still running after ${Math.round((Date.now() - started) / 1000)}s. Call get_analysis with this sessionId to check again, or view it at ${WEB_URL}/?chat=${threadId}.`,
    progress: last?.toolStatus ?? null,
  });
}

export async function getAnalysis(sessionId: string): Promise<string> {
  const s = await api(`/api/analyze/status?sessionId=${encodeURIComponent(sessionId)}`, { auth: true });
  if (s.status === "done") return `Analysis complete (session ${sessionId}).\n\n${s.content ?? "(no content)"}`;
  if (s.status === "error") return `Analysis failed (session ${sessionId}): ${s.error ?? "unknown error"}`;
  return j({ status: s.status, sessionId, progress: s.toolStatus ?? null, partial: s.content ?? null });
}
