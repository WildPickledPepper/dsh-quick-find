# dsh-quick-find

Ctrl+F in-conversation search for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Press **Ctrl+F** (Cmd+F on macOS) inside an open conversation and a small find bar
appears in the top-right corner: it highlights every hit in the rendered
conversation, shows `3 / 12`, and jumps between hits with **Enter** /
**Shift+Enter** (or the ↑ ↓ buttons). **Esc** closes it.

No API keys, no host-side daemon, no session data is touched — this is a pure
client-side plugin.

## Install

```sh
dsh plugin --profile <profile> add dsh-quick-find
# or from GitHub
dsh plugin --profile <profile> add github:<owner>/dsh-quick-find
```

Then restart DeepSeek Harness (the host half is a no-op, but the client module
list is composed at boot) and refresh the page.

## Notes

- Highlighting uses the CSS Custom Highlight API (`CSS.highlights` + a
  `::highlight()` rule), so no DOM mutation happens and React re-renders cannot
  fight the highlights.
- Only **mounted** messages can be matched. Harness virtualizes long histories;
  scroll the older turns into view first if you need to search them.
- The search box is inserted as a plain DOM node, so it works in the desktop app
  and in `dsh web`.
- If nothing is found, the counter says `无结果`.

## Compatibility

Tested on DeepSeek Harness `0.2.1-rc.3` (desktop). The plugin imports nothing
from `@deepseek-ai/*`, which is what keeps it loadable when the host ships its
packages inside `app.asar`.

## License

MIT
