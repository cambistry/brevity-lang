---
created: 2026-11-27
---
# A cell of a view type should take `<-` through `self set`

Design: `notes/file-views-and-codecs-2026-11-27.md`. Depends on `a-one-field-type-declares-self-as-presentations`.

```brevity
type Lines(Text) {
  self as List[Text] = (text) -> split(text)
  self set = (lines List[Text]) {
    over(lines) (line) { if (contains(line, "\n")) { throw … } }
    join(lines, "\n")
  }
}

ls *Lines = Lines("a\nb")
@put! = { ls <- ["x", "y"] }
```

Want:

- `x <- v` into a `*V` cell, where `v` isn't a `V`, dispatches on `v`'s type to the matching
  `self set`. The `set` returns the new positional value, which the cell stores.
- A `set` may take the current positional value first: `self set = (doc, body Text) -> …`.
- A `set` that throws fails the write; the cell keeps its value.
- No matching `set` is a compile error.
- Every target.
