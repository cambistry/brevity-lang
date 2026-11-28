---
created: 2026-11-27
---
# `File(path)` should be a host actor

Design: `notes/file-views-and-codecs-2026-11-27.md`, "What runs where". Tests use `*.fs.test.js`
(`a-test-suffix-marks-tests-that-need-a-file-system`).

Want: `use File`; `File("p")` addresses a host actor holding the file's bytes, answering:

- `read`, replying `(text, version)`, the version a content hash;
- `write(text, if: version)`, replying `ok` or `conflict`; a write with no version is
  unconditional;
- `sub`, pushing `(text, version)` on every change, through it or on disk;
- metadata in its named lane: `:created_at`, `:modified`, `:path`.

A literal path is hoisted into the manifest as a grant; a computed path must fall under a declared
grant (from `files-as-addressed-values-dir-and-file`). A write counts as a write for `!`.

js on Node first, then erlang and rust. On the browser, `use File` is a compile error.
