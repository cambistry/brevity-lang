---
created: 2026-11-27
---
# `Dir[C]` should be a keyed collection of Files

Design: `notes/file-views-and-codecs-2026-11-27.md`, "Collections" and "A glob is a key focus". Depends on `file-of-c-binds-a-typed-address`.

```brevity
tickets = Dir[TicketFile]("../tickets/*.md")
tickets.keys
body Text = tickets[slug]
tickets[slug]::FrontMatter <! :status
tickets.remove!(slug)
```

Want:

- `Dir[C]("p")` is a typed address over a Dir host actor answering `keys`, `add`, `remove!` and
  `sub` on the listing.
- `tickets[k]` is a `File[C]` typed address for the entry.
- A glob narrows the keys and strips its fixed parts (`slug.md` reads as `slug`).
- Writing a new key creates the file; a key that can't fit the glob is a failed write.

js, erlang, rust.
