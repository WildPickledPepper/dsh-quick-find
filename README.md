# dsh-quick-find

Ctrl+F search for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — including the parts of the conversation Harness has not rendered yet.

Press **Ctrl+F** (Cmd+F on macOS) inside an open conversation. A find bar appears in
the top-right corner and searches twice:

1. **Rendered messages** — instant, every hit is highlighted, `页内 3/12`, jump with
   **Enter** / **Shift+Enter** (or ↑ ↓).
2. **The whole session log on the host** — `GET /session-find/search?q=…&session=…`
   decompresses `session.v4.jsonl.zstd` and lists hits with role + snippet, so long
   histories that Harness virtualized away are still searchable.

`Esc` closes the bar.

## Install

```sh
dsh plugin --profile <profile> add github:WildPickledPepper/dsh-quick-find
```

Restart DeepSeek Harness (the host half registers the search route at boot), then
refresh the page.

## Notes

- Highlighting uses the CSS Custom Highlight API (`CSS.highlights` + a
  `::highlight()` rule): no DOM mutation, so React re-renders cannot fight it.
- History hits that are **not** on screen yet cannot be scrolled to. Clicking one
  tells you which turn it is; scroll the older turns in first, then click again.
- The session log is stored as a sequence of independent zstd frames (one per
  append). Node's decompressor stops after the first frame, so the host half finds
  frames by their magic number and decodes them one by one.
- Search covers user, assistant and tool-result text. Reasoning blocks are skipped
  by default so the result list stays readable.
- The plugin imports nothing from `@deepseek-ai/*`, which keeps it loadable when
  the host ships its packages inside `app.asar`.

## Compatibility

Tested on DeepSeek Harness `0.2.1-rc.3` (desktop). Needs Node 22.15+/24 for
`zlib.zstdDecompressSync`.

## License

MIT
