---
description: Run a deep Datatrove analysis on a saved thread
argument-hint: [thread-id] [optional focus]
allowed-tools: mcp__plugin_datatrove_datatrove__analyze, mcp__plugin_datatrove_datatrove__get_analysis, mcp__plugin_datatrove_datatrove__list_my_threads
---

Run a Datatrove analysis. Arguments: **$ARGUMENTS**

- If a thread id was given, call `analyze` with that `thread_id` (and any focus as `question`).
- If no thread id, call `list_my_threads` and ask the user which thread to analyze — or suggest running `/datatrove:ask` first to create one.

Analyses can take several minutes. If `analyze` returns "still running" with a session id, use `get_analysis` to check back. This needs a signed-in **Pro** account — if it errors with a plan or quota message, relay it plainly. Present the findings; note that any ` ```vega-lite ` charts render on datatrove.ai (the terminal shows them as code).
