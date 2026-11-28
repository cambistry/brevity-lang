---
created: 2026-11-27
---
# A named presentation should be read and written with `::`

Design: `notes/file-views-and-codecs-2026-11-27.md`. Depends on `a-cell-of-a-view-type-takes-writes-through-self-set`.

```brevity
type Markdown(Text) {
  self as Text = (doc) -> …the body…
  self set = (doc, body Text) -> …
  FrontMatter as Map[Text, Text] = (doc) -> …
  FrontMatter set = (doc, fm Map[Text, Text]) -> …
}

md *Markdown = Markdown("---\nstatus: x\n---\n# T\n")
fm = md::FrontMatter
md::FrontMatter <- (status: "done")
```

Today: `::` reaches a protected member (`base::h`) or qualifies a namespace (`HTML::div`).

Want: a type may name a presentation (`Name as T`, `Name set`), reached as `x::Name` for reads and
writes. Only a declared name is reachable. Decide first how this third meaning of `::` stays
unambiguous beside the other two. Every target.
