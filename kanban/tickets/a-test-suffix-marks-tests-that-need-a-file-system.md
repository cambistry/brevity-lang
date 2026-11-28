---
created: 2026-11-27
---
# A test suffix should mark tests that need a file system

Today: `*.dom.test.js` runs only in the `dom` project; every other test runs on every target.
`memory/testing.md` forbids per-target skipping by any mechanism, file naming included, so a
pending port stays red.

Want: `*.fs.test.js` runs on js, erlang and rust, and not in the `browser` or `dom` projects
(`jest.config.js`), because the browser has no file system by design.

- The suffix names the capability, not the target, so each exclusion says why. A later
  capability (processes, sockets) gets its own suffix.
- The browser keeps a plain `*.test.js` asserting that `use File` and `Dir(…)` are compile errors
  on the browser target, so the exclusion is a tested refusal, not silence.
- `memory/testing.md` says when a suffix is allowed: only for a capability a target lacks by
  design, named in the suffix. A pending port still stays red.

First of the file-views series (`notes/file-views-and-codecs-2026-11-27.md`); tickets that test File or Dir use the suffix.
