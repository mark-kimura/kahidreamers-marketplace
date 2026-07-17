---
description: Browse the Datatrove data-source catalog
argument-hint: [optional: a source id, or search terms]
allowed-tools: mcp__plugin_datatrove_datatrove__list_sources, mcp__plugin_datatrove_datatrove__get_source, mcp__plugin_datatrove_datatrove__search_datasets
---

Help the user explore Datatrove's data-source catalog. Arguments: **$ARGUMENTS**

- **No arguments** → call `list_sources` and summarize the sources (name, dataset count, coverage years, quality/stale-copy counts).
- **A source id** (e.g. `ca_cdi`) → call `get_source` and show its datasets and any quality issues.
- **Free-text** → call `search_datasets` and present matches with their verbatim source and download URLs.

The catalog is state-scoped (US-HI default, US-CA where enabled). Pass `state` to the tools if the user asks about a specific state.
