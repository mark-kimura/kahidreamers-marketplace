import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── Config (overridable via env, for dev / self-hosting) ──────────────────
export const API_URL = (process.env.DATATROVE_API_URL || "https://api.datatrove.ai").replace(/\/+$/, "");
export const WEB_URL = (process.env.DATATROVE_WEB_URL || "https://datatrove.ai").replace(/\/+$/, "");
// Catalog is state-scoped (US-HI default; US-CA where enabled). One home state
// per install; individual tools may override per call.
export const DEFAULT_STATE = process.env.DATATROVE_STATE || "US-HI";

// Persist the credential in the plugin's durable data dir (survives updates);
// fall back to ~/.datatrove for non-plugin / dev runs.
const DATA_DIR = process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), ".datatrove");
export const CRED_PATH = path.join(DATA_DIR, "credentials.json");

// ─── Credential store (mode 0600) ─────────────────────────────────────────
export type Creds = { token: string; apiUrl: string; email?: string | null };

export function loadCreds(): Creds | null {
  try {
    const c = JSON.parse(fs.readFileSync(CRED_PATH, "utf8"));
    if (c && typeof c.token === "string") return c as Creds;
  } catch {
    /* not logged in */
  }
  return null;
}

export function saveCreds(c: Creds): void {
  fs.mkdirSync(path.dirname(CRED_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(CRED_PATH, JSON.stringify(c, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(CRED_PATH, 0o600);
  } catch {
    /* best effort (e.g. Windows) */
  }
}

export function clearCreds(): void {
  try {
    fs.unlinkSync(CRED_PATH);
  } catch {
    /* already gone */
  }
}

// ─── HTTP ──────────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message || code);
  }
}

/**
 * JSON REST helper. Attaches the cached bearer token when `auth` (or always, if
 * present and harmless). Throws ApiError with a friendly message on !ok. Not for
 * the streaming /api/chat endpoint — see discover() in tools.ts.
 */
export async function api(
  pathAndQuery: string,
  opts: { method?: string; body?: unknown; auth?: boolean; state?: string } = {},
): Promise<any> {
  const { method = "GET", body, auth = false, state } = opts;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (state) headers["X-Dt-State"] = state;

  const creds = loadCreds();
  if (auth && !creds) {
    throw new ApiError(401, "not_logged_in", "You're not signed in to Datatrove. Run /datatrove:login first.");
  }
  if (creds) headers["Authorization"] = `Bearer ${creds.token}`;

  const res = await fetch(`${API_URL}${pathAndQuery}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const code = json?.error || `http_${res.status}`;
    if (res.status === 401) {
      throw new ApiError(401, code, "Your Datatrove session is invalid or was revoked. Run /datatrove:login to reconnect.");
    }
    if (res.status === 402 || code === "plan_required" || code === "quota_exceeded" || code === "analyze_not_allowed") {
      throw new ApiError(res.status, code, json?.message || `${code} — this action needs a Pro plan or you've hit a quota. Upgrade at ${WEB_URL}/upgrade.`);
    }
    throw new ApiError(res.status, code, json?.message || code);
  }
  return json;
}

export function requireState(state?: string): string {
  return state || DEFAULT_STATE;
}
