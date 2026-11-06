# pi-agent-notify

A Linux desktop notification and audio extension for Pi. Version 0.1.0 extracts the active production source unchanged, including the herbe timeout and forced-kill settings.

## Install

After the `v0.1.0` tag is published:

```sh
pi install git:github.com/MateoGreil/pi-agent-notify@v0.1.0
```

**Do not load both this package and a local copy** such as `~/.pi/agent/extensions/agent-notify.ts`. Disable or remove the old extension first to avoid duplicate notifications and audio.

## Requirements and behavior

Currently **Linux-only**. Requires `herbe` and `paplay` on `PATH`, a working X11 display/audio session, and `/usr/share/sounds/freedesktop/stereo/message.oga`. There is no macOS backend yet; macOS support is future work, not part of this extraction. No other notification backend is provided.

- Records time on `agent_start` and checks notifications on **`agent_end`**.
- Suppresses notifications when `ctx.hasUI` is false, messages are pending, the run is shorter than the threshold, or the last usable assistant message is aborted. RPC also reports `hasUI`, so it can notify.
- `PI_NOTIFY_MIN_MS` is parsed at extension load, defaults to `3000`, and can be set to `0` to disable the duration filter. A run exactly at the threshold is eligible.
- Uses the first non-empty trimmed text line from the last assistant message with array content, truncating lines over 120 characters to 117 plus an ellipsis. Thinking/tool blocks do not become previews.
- Error previews get an error marker; empty previews retain the existing French fallbacks `Erreur` / `Terminé`. Titles use `pi - <cwd basename>`, or `pi` when empty.
- Calls `herbe` with a **10,000 ms timeout and `SIGKILL`**, and `paplay` with the sound path above. Both inherit the environment and use `DISPLAY`, defaulting to `:0`. Subprocess errors are ignored; there is no fallback if dependencies are missing.

**Lifecycle limitation:** `agent_end` marks a low-level run ending, not final idle. Pi may still retry, compact, or continue automatically afterward. Pending-message suppression does not guarantee a single notification only after all work settles. This behavior is intentionally unchanged.

## Compatibility and tests

Verified against `@earendil-works/pi-coding-agent` **1.5.0** on Node **22.22.3**. Node **>=22.22.0** is required. Uses the SDK's `agent_start`/`agent_end` events and UI/pending-message context fields; no private SDK methods are called. The `*` peer range denotes a host-provided SDK, not tested compatibility with every version.

With the pinned development dependency available:

```sh
npm test
```

Tests mock `child_process.execFile` and `Date.now`, and isolate environment settings. They check suppression, previews, titles, threshold settings, herbe timeout/kill signal, display environment, and audio arguments. No real desktop notifications or sounds are sent. Offline extraction checks can use an ignored `node_modules` symlink to an installed Pi 1.5.0 release.

## Distribution

Intended for a public Git repository and git-based Pi installation. `private: true` prevents accidental npm publication. `UNLICENSED` is deliberate until a license is chosen; a public repository is not automatically licensed for reuse.
