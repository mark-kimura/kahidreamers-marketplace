---
description: Connect your Datatrove account (opens a browser to approve)
disable-model-invocation: true
allowed-tools: mcp__plugin_datatrove_datatrove__login, mcp__plugin_datatrove_datatrove__complete_login
---

Sign the user in to Datatrove.

1. Call the `login` tool. Show the user the authorization URL it returns and tell them to click **Approve** in the browser that opens.
2. Then call `complete_login`:
   - On a **local machine**, it completes automatically once they approve — call it with no arguments.
   - On a **remote / SSH / web session**, the browser can't reach Claude Code, so the approval page shows a **code**. Ask the user for that code and pass it as the `code` argument.

When it succeeds, confirm the signed-in email.

If it fails, relay the error verbatim — the server's messages are already
written for the user. Two cases deserve a specific response rather than a
generic retry offer:

- **Pro plan required.** The plugin is available on Pro and Admin accounts. Do
  NOT suggest retrying `/datatrove:login` — it will fail identically until the
  account is upgraded. Point the user at https://datatrove.ai/upgrade and stop.
- **Approval not detected.** This is the remote/SSH case: ask for the code shown
  on the approval page and call `complete_login` with it. Retrying `login` from
  scratch is not necessary.
