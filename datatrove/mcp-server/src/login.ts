import http from "node:http";
import os from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { AddressInfo } from "node:net";
import { API_URL, WEB_URL, saveCreds, clearCreds, loadCreds } from "./util.js";

const b64url = (b: Buffer): string => b.toString("base64url");

/** Best-effort cross-platform "open this URL in the default browser". */
function openBrowser(url: string): void {
  try {
    if (process.platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    } else if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    } else {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch {
    /* user can open the URL manually — it's returned in the tool result */
  }
}

const CLOSE_PAGE = (msg: string, ok: boolean) => `<!doctype html><meta charset=utf-8>
<title>Datatrove</title>
<body style="font-family:ui-sans-serif,system-ui;background:#0a0b0a;color:#e2e3df;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="text-align:center;max-width:24rem">
<div style="font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:${ok ? "#34d399" : "#f87171"}">Datatrove · Claude Code</div>
<h1 style="font-size:1.25rem;margin:.5rem 0">${msg}</h1>
<p style="color:#8a8f86;font-size:.9rem">You can close this tab and return to Claude Code.</p>
</div></body>`;

type Pending = {
  verifier: string;
  state: string;
  server?: http.Server; // present until the loopback is closed
  wait?: Promise<string>; // resolves when the loopback catches the code (local setups)
};
let pending: Pending | null = null;

/**
 * Step 1 of login: start a loopback listener, open the browser to the consent
 * page, and return the authorize URL (so the user can open it manually if the
 * browser didn't). The loopback + PKCE verifier are held in module state until
 * completeLogin() consumes them.
 */
export async function beginLogin(): Promise<{ authorizeUrl: string }> {
  // Tear down any previous half-finished attempt.
  if (pending) {
    try { pending.server?.close(); } catch { /* noop */ }
    pending = null;
  }

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const wait = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname !== "/cb") {
        res.writeHead(404).end();
        return;
      }
      const gotState = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (gotState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" }).end(CLOSE_PAGE("Authorization mismatch", false));
        rejectCode(new Error("state_mismatch"));
        return;
      }
      if (error || !code) {
        res.writeHead(200, { "Content-Type": "text/html" }).end(CLOSE_PAGE("Authorization cancelled", false));
        rejectCode(new Error(error || "no_code"));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" }).end(CLOSE_PAGE("You're connected", true));
      resolveCode(code);
    } catch (e) {
      try { res.writeHead(500).end(); } catch { /* noop */ }
      rejectCode(e instanceof Error ? e : new Error(String(e)));
    }
  });

  // `server.listen` is async — the port is only reliably available on the
  // "listening" event, so resolve after it fires.
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/cb`;
  const authorizeUrl =
    `${WEB_URL}/cli/authorize` +
    `?redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}` +
    `&code_challenge=${encodeURIComponent(challenge)}`;

  openBrowser(authorizeUrl);
  pending = { verifier, state, server, wait };
  return { authorizeUrl };
}

function closeServer(): void {
  if (pending?.server) {
    try { pending.server.close(); } catch { /* noop */ }
    pending.server = undefined;
    pending.wait = undefined;
  }
}

async function exchange(code: string, verifier: string): Promise<{ email: string | null }> {
  const res = await fetch(`${API_URL}/api/cli/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, name: `Claude Code (${os.hostname()})` }),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Token exchange failed: ${b.error || `http_${res.status}`}`);
  }
  const data = (await res.json()) as { token: string; user?: { email?: string | null } };
  saveCreds({ token: data.token, apiUrl: API_URL, email: data.user?.email ?? null });
  return { email: data.user?.email ?? null };
}

/**
 * Step 2 of login. Two paths, both after the user clicks Approve in the browser:
 *  - `code` provided → the user copied the code from the approval page (works
 *    everywhere, including remote/SSH where the loopback is unreachable).
 *  - `code` omitted → wait for the loopback listener to catch the redirect
 *    automatically (local setups). On timeout, keep the PKCE verifier so the
 *    user can still paste the code afterward.
 */
export async function completeLogin(opts: { code?: string; timeoutMs?: number } = {}): Promise<{ email: string | null }> {
  if (!pending) throw new Error("No login in progress. Run /datatrove:login first.");
  const { verifier } = pending;

  // Manual paste path.
  if (opts.code && opts.code.trim()) {
    const code = opts.code.trim();
    closeServer();
    const out = await exchange(code, verifier);
    pending = null;
    return out;
  }

  // Automatic loopback path.
  if (!pending.wait) {
    throw new Error("Approval not detected automatically. Copy the code shown in your browser and provide it to complete_login.");
  }
  const wait = pending.wait;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("timed_out")), timeoutMs);
  });

  let code: string;
  try {
    code = await Promise.race([wait, timeout]);
  } catch (e) {
    // Timed out (likely remote — loopback never reachable). Keep the verifier so
    // a follow-up paste can still complete; just drop the dead listener.
    closeServer();
    if (e instanceof Error && e.message === "timed_out") {
      throw new Error(
        "Didn't detect the approval automatically — this usually means Claude Code is running on a different machine than your browser. Copy the code shown on the approval page and call complete_login again with it.",
      );
    }
    pending = null;
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }

  closeServer();
  const out = await exchange(code, verifier);
  pending = null;
  return out;
}

/** Revoke the current token server-side and delete the local cache. */
export async function logout(): Promise<{ wasLoggedIn: boolean }> {
  const creds = loadCreds();
  if (!creds) return { wasLoggedIn: false };
  try {
    await fetch(`${API_URL}/api/cli/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}` },
    });
  } catch {
    /* revoke best-effort; still clear locally */
  }
  clearCreds();
  return { wasLoggedIn: true };
}
