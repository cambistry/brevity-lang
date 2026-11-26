---
created: 2026-11-24
---
# Dogfood the kanban board in Brevity

Want: port `kanban/board.mjs` to Brevity, starting nestled in a Node.js project: the JS target plus a Node host, the way the browser target is the JS target plus `brevity.js` (`notes/browser-target-2026-04-01.md`). JS modules as actors (same note, "JS Interop") may be the first bridge: wrap the Node APIs the board needs, then replace wrappers with library support as it lands.

Today: the board leans on:

- Files: read, write, list a directory, existence, temp files.
- Processes: async `git` with captured output and exit status, run serially; a blocking editor run that inherits the terminal.
- Terminal: raw-mode key input, stdout writes (ANSI), size and resize events, alternate screen.
- Timers: an interval poll.
- Process lifecycle: env vars, exit codes, SIGTERM/SIGHUP, last-chance cleanup on crash.
- Text: line splitting, regex-level parsing of front-matter and list files, Unicode-aware width and wrapping.

Open: which of these are library actors vs. host bindings; whether the Node host is a target of its own or a mode of the JS one.

Follow-on: `agent-updates-tickets-through-the-board-s-opre-api`, the agent working tickets through the board's Opre API.
