---
status: inbox
created: 2026-11-25
---
# Files as addressed values: `Dir` and `File`

Design (a concept, not decided): `notes/files-as-addressed-values-2026-11-25.md`. Mocked up in `kanban/speculative/board.bv`.

```brevity
use Dir, File

type TicketFile = FrontMatter[status Text?, created Text?]

tickets *Map[Text, TicketFile] = Dir("./tickets/*.md")
columns Lines = File("./columns")

tickets[slug].status <- "review"
```

Want:

- `use Dir, File`: the runtime environment defines them and their limits.
- A literal path is hoisted into the manifest as a grant; a computed path must fall under a declared grant.
- The left side gives shape and capability: a snapshot, `&` live read-only, `*` live writable; `<-` through a `*` reference writes the file, and counts as a write for `!`.
- Entry types own their stored form (`Lines`, `FrontMatter[fields]`, native otherwise); named entries belong to the type; file-system metadata is `:file`.

Settle the note's open questions first: cell versus reference on the left, concurrency, watch granularity, metadata writes, host-defined addresses, where document types live.
