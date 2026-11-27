---
created: 2026-11-26
---
# Clause lists: a list of functions is callable, with pattern heads

Design: `notes/clause-lists-2026-11-25.md`, settled by `notes/pipe-and-clause-lists-settled-2026-11-26.md`. Needs `|>` (`clause-lists-follow-up-pipe-into-a-list-of-functions`).

Today: a function is a list of functions (the 2026-04-06 overload model: `=` starts the list, `<<` appends, `Function()` is empty). Overloads select by arity and type only; there are no literal heads (`@fib << (0) -> 0`) and no literal unions (`"a" | "b"`).

Want: a list literal of clauses is that list written as a value.

```brevity
key |> [
  "enter" | "esc" -> back
  "r" -> { board.load!; self }
  (x == 1) -> do!
  else -> @walk!(key)
]
```

- Calling a List walks it from the head; `List[T](args)` compiles only when `T` is a function type.
- Clauses: `head -> expr` and `head -> { block }`; `else` as the catch-all, last.
- Heads: literal patterns (extending overload dispatch to values), `"a" | "b"`, Boolean heads as conditions, computed heads in parens.
- A Boolean input to a list with a pattern clause is a compile error ("a Boolean is matched with if/else").
- Writes: a named clause list takes `!` if any clause writes; an anonymous one's writes belong to the function that defines it.
- `Function()` and a typed `[]` are the same empty clause list; an untyped `[]` can't be called.

Not in this ticket: guards, which are a body's `return unhandled` (`implement-return-unhandled-bv-equivalent-of-a-guard`; there is no `when` head), bare multi-params (`arrow-functions-take-bare-comma-params`), and `()` for zero params (`zero-param-arrow-functions-take-parens`).

From `arrow-functions-take-bare-comma-params` (2026-11-26): bare comma params (`a, b -> …`, untyped) exist right of `=` and as a line of their own in a multi-line list. Multi-argument pattern heads (`0, y -> y`, `"a", "b" -> …`) are this ticket's: a clause line's bare comma list may hold literals.

**Decided (2026-11-26):**

- **Scope:** a clause-list literal as a function (piped, `v |> [ … ]`, or bound, `keys = [ … ]`), with literal heads, `"a" | "b"`, condition heads `(expr)`, `else`, bare-name and typed-param heads, multi-argument heads (`0, y -> y`); the Boolean-subject error; writes; `Function()` and a typed `[]` as the same empty clause list.
- **Lowering:** a clause-list literal compiles to an anonymous overloaded function, a clause per line, as `f = …` then `f << …`. Until `lists-of-functions-as-runtime-values`, a clause list isn't indexed, sorted or concatenated.
- **No match** is `unhandled`, as for any overload; in a value position it fails the enclosing function the same way.
