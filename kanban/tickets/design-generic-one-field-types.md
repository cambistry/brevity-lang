---
created: 2026-11-27
---
# Design: generic one-field types

From `notes/file-views-and-codecs-2026-11-27.md`, open question on `type TicketFile Markdown[TicketMeta]`.

```brevity
type Markdown[M](Text) {
  FrontMatter as M = (doc) -> …
  FrontMatter set = (doc, fm M) -> …
}
type TicketMeta(status: Text?, created: Text?)
type TicketFile Markdown[TicketMeta]
```

Decide:

- The spelling of a type parameter on a one-field type (`Markdown[M](Text)` is invented).
- Whether `type TicketFile Markdown[TicketMeta]` is an alias of the instantiation or a nominal
  type that keeps Markdown's presentations.
- How a parameter's functions are named inside the body (also open in
  `notes/type-namespaces-2026-11-25.md`).
