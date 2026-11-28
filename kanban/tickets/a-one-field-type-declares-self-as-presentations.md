---
created: 2026-11-27
---
# A one-field type should declare `self as` presentations

Design: `notes/file-views-and-codecs-2026-11-27.md`, "A view type presents itself with `self as` and `self set`".

```brevity
type Lines(Text) {
  self as List[Text] = (text) -> split(text)
}

@t = {
  xs List[Text] = Lines("a\nb")
  return value: xs
}
```

Today: an actor may declare several `self as` clauses, one per target type
(`__tests__/keywords/self_as.test.js`). A type's body is a namespace of pure functions
(`a-type-declaration-carries-a-namespace-of-functions`).

Want: a one-field type's body declares `self as T` clauses. Each takes the positional value as
its parameter. A typed bind of a different type reads through the matching clause, as for an
actor; no matching clause is a compile error. `(text) = ls` still destructures the stored value.
Every target.
