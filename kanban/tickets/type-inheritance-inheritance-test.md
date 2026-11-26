---
status: todo
created: 2026-05-20
---
# A type extends a type

Like extending a class: a type built from another type's fields plus its own.

```brevity
type Pt (x Integer, y Integer)
type Pt3 = Pt ^ (z Integer)
```

Today this fails to parse ("'type Pt3': its fields go on the lines below it, or in parens"). The spelling is to decide; `^` follows class composition (notes/caret-composition-2026-11-19.md).

Decide:

- The spelling, and the pure-inheritance case (a new name with no added fields).
- Whether a `Pt3` value fits a `Pt` slot (the type analogue of a subclass in a parent-typed slot), and how the service document and `ty` express the relationship.
