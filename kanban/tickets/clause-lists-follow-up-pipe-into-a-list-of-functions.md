---
status: inbox
created: 2026-11-25
---
# Clause lists follow-up: pipe into a list of functions

Design: `notes/clause-lists-2026-11-25.md`. A function is a list of functions (the 2026-04-06 overload model: `=` starts the list, `<<` appends, `Function()` is empty), and a list literal of clauses is that list written as a value.

```brevity
key |> [
  "enter" | "esc" -> back
  "r" -> { board.load!; self }
  (x == 1) -> do!
  else -> @walk!(key)
]
```

To settle and then build:

- `|>`, the Elixir pipe (`v |> f(a)` is `f(v, a)`).
- Calling a List walks it from the head; `List[T](args)` compiles only when `T` is a function type.
- Clauses: `head -> expr` and `head -> { block }`; `else` as the catch-all, last.
- Heads: literal patterns (extending overload dispatch to values), `"a" | "b"`, Boolean heads as conditions, computed heads in parens.
- A Boolean input to a list with a pattern clause is a compile error ("a Boolean is matched with if/else").
- Arrow params: bare `a, b ->` where nothing to the left owns the comma; `()` required for zero params.

Open in the note: writes in a clause (anonymous functions have no name to carry `!`), whether `Function()` is `[]`, and Elixir-style `when` binding.
