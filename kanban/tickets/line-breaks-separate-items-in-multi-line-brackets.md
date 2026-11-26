---
status: inbox
created: 2026-11-25
---
# Line breaks should separate items in multi-line brackets

Want: inside `( )` and `[ ]`, a line break separates items, as a comma does:

```brevity
Ticket(
  :slug
  title: either(heading, slug)
  created: field(front, "created")
)
```

Clause lists rely on it (`notes/clause-lists-2026-11-25.md`), and so do params one per line (`notes/lineal-definitions-2026-11-25.md`).

Want (in edge cases):

1. **An item spanning lines:** a break ends the item unless the line ends with something that can't end an expression (a binary operator, `|>`, an open bracket), so `a +` then `b` stays one item.
2. **A next line starting with `(` or `[`:** `[f` then `(x)]` is two items, never the call `f(x)`.
3. **A next line starting with `-`:** `[a` then `-1]` is two items, never `a - 1`.

Want: commas stay legal on one line; a trailing comma before a break is fine, so pasted code still parses.
