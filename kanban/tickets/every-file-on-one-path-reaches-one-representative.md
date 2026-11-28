---
created: 2026-11-27
---
# Every File on one path should reach one representative

Design: `notes/file-views-and-codecs-2026-11-27.md`, "One File per path". Depends on `file-should-be-a-host-actor`.

Want: two `File`s or `Dir`s on one path, in one compilation or several, reach the same
representative actor. The file-system actor under the root routes every message by path and
spawns the representative on the first message for it, as the DOM subsystem routes element
addresses (`notes/dom-as-actor-subsystem-2026-04-13.md`). A `sub` from any of them sees every
write. js, erlang, rust.
