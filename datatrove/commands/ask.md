---
description: Ask Datatrove where to find public data (discovery chat)
argument-hint: [your question]
allowed-tools: mcp__plugin_datatrove_datatrove__discover
---

Answer the user's data-discovery question with the `discover` tool: **$ARGUMENTS**

Pass the question through verbatim. Present the datasets it surfaces with their source and download URLs **exactly as returned** — never shorten, guess, or alter a URL. Note any freshness caveats it mentions. If the result includes a saved thread id, tell the user they can run a deep analysis on it with `/datatrove:analyze`.
