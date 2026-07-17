---
description: List and open your saved Datatrove threads
argument-hint: [optional thread-id to open]
allowed-tools: mcp__plugin_datatrove_datatrove__list_my_threads, mcp__plugin_datatrove_datatrove__get_thread
---

Show the user their saved Datatrove conversation threads. Arguments: **$ARGUMENTS**

Call `list_my_threads` and list each thread's title, id, and last-updated date (most recent first). If the user named or pasted a thread id, open it with `get_thread` and summarize the conversation. Requires sign-in — if it errors as unauthorized, tell the user to run `/datatrove:login`.
