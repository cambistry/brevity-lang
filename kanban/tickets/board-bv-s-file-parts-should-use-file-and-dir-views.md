---
created: 2026-11-27
---
# board.bv's file parts should use `File[C]` and `Dir[C]`

`kanban/speculative/board.bv` keeps current with each decision
(`make-kanban-speculative-board-bv-compile-and-run`). Its file parts still use the 11-25 design:
`*Map[…] = Dir(…)`, `FrontMatter[…]`, `:file`.

Want: they read as `notes/file-views-and-codecs-2026-11-27.md`'s "The board, applied": `Dir[TicketFile]`, `Dir[Lines]`,
`File[Lines]`, `::FrontMatter`, typed-bind reads, and the Editor's body-only write.
