---
status: inbox
created: 2026-11-25
---
# REVISIT: Return types in the function header

Design: `notes/return-types-in-the-header-2026-11-25.md`. Supersedes the `!` body rules in `notes/mutation-suffix-2026-10-31.md`.

Want:

```brevity
@create! = (title Text, status Text) : Text { …; slug }
@point! = (at Integer) : self { row <- clamp(at, 0, last) } // explicit self
carryTo! = (i Integer) { if (board.at(i) == null) { return }; … }
```

- `(params) : Type` before `{` or `->`; the compiler checks every return point, the tail included.
- Tail implicit return in every function. A `!` function with no type returns `self`; a bare `return` is `return self`.
- `: self` is the only spelling of "returns its receiver". Constructors take no type. A typed zero-param function needs `()`.
- Parse rules for interface, function and structure return types are in the note.

Today: the `!` rules make a tail value an error and require `return self` on mixed paths; tests asserting those change.
