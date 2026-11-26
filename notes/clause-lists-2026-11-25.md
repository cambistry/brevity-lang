# Clause lists: a function is a list of functions — 2026-11-25

Design, not implemented. Came out of rewriting `kanban/board.bv` in speculative notation.
Builds on function overloads (`__tests__/functions/overload.md`) and
`caret-composition-2026-11-19.md`. Adds the Elixir pipe (`|>`), which no earlier note covers.

## Origin

The overload model of 2026-04-06 already treats a function as an ordered list of clauses. It was
recorded only in commits and tests, never in a note:

- `9f62b0a`: "the overload model: = creates, << appends, >> prepends". (`>>` was removed later;
  ticket `function-overload-prepend-removed`.)
- `713232f`: `<<` and `>>` as overload clause operators; `Function()` as the empty overload.
- `f79ee66`: "A constructor is just a function clause that returns a new actor. The overload
  dispatch list doesn't care what clauses return." (See `constructor-star-prefix-2026-11-25.md`.)
- `ssa-immutability-2026-04-09.md`: `<<` and `>>` "mutate a handler chain, not a binding".

## The idea

A function is a list of functions. Calling it walks the list from the head, and the first clause
that accepts the arguments answers. `=` starts the list, `<<` appends to it, and `Function()` is
the empty list. A clause list literal is the same thing written as a value, so calling a List is
List behaviour: `[&fn1, &fn2](args)` walks it.

- **`<<` is appending.** `[ … ] + more` adds clauses the same way.
- **Order is dispatch.** The order you read is the order clauses are tried; `List.sort` on a
  clause list changes which clause wins.
- **The compile check is the element type.** `List[T](args)` compiles only when `T` is a function
  type (a union of clause profiles counts). `["a", "b", "c"](1)` is a compile error. A
  `List[Anything]` is refused too: a list from mixed sources needs `as List[(Text) -> View]` or
  similar before it can be called.
- **Indexing stays `[ ]`, from 0.** `xs[i]` reads an entry, `fs(args)` applies the clauses. Calling
  never indexes, so `[f, g](1)` is unambiguous.

Named dispatch belongs to actors, not Objects: an object of functions dispatched by label is an
actor, and `actor { … }` already spells it. Object stays data, the shape of arguments and replies.

| Form | What it is |
|---|---|
| `[ … ]` | ordered clauses, callable |
| `actor { … }` | named members, sent messages |
| `( … )` | data: arguments and replies |

`<<` appends clauses and the earlier one wins; `^` merges layers and the later one wins.

## Form

```brevity
key |> [
  "enter" -> peek
  "space" -> grab!
  "enter" | "esc" -> back
  "r" -> { board.load!; self }
  (x == 1) -> do!
  else -> @walk!(key)
]
```

- **`|>` is the Elixir pipe.** `v |> f(a)` is `f(v, a)`. Piping into a clause list applies it to
  the value, which gives Elixir's `case` and `cond` in one form.
- **Every clause has an arrow: `head -> expr` or `head -> { block }`.** One shape keeps the
  column of heads and arrows aligned, and a bare `"r" { … }` would read as a value followed by a
  block. Inside a list literal, a head followed by `->` on the same line is one element.
  `else { … }` may drop the arrow, since `else` is a keyword, as in `if`/`else`.
- **Clauses are tried in order; the first match answers.** No match is `unhandled`, as for any
  overload.
- **`else`** is a catch-all clause, the same as `true ->`. Anything after it can never match, so
  that is a compile error.

## Heads

- **A head of the subject's type is a pattern,** compared with the value piped in:
  `"enter" -> …`. Literal patterns extend overload dispatch, which today selects by arity and
  type, to values (`@fib << (0) -> 0`).
- **`"a" | "b"`** is a union of literal types: either matches.
- **A head that evaluates to a Boolean is a condition:** `true` matches, `false` never does.
  The subject is ignored, so the clause is `_` with a condition and still fits the list's
  one-argument profile.
- **Literal heads are bare before `->`; computed heads always take parens:** `(x == 1) -> …`.
  This matches the parens rule for `if` conditions, and keeps `check(x) { … }` from reading as a
  call with a trailing function.

## Arrow params

**Several bare params.** The arrow lets a function drop its param parens even with more than one
param: `add = a, b -> a + b`. In a clause list this gives multi-argument patterns:

```brevity
pair |> [
  0, y -> y
  x, 0 -> x
  x, y -> x + y
]
```

A bare comma list is a param list only where nothing to its left owns the comma:

- **Allowed:** right of `=`, and as a whole line in a multi-line list or clause list (where line
  breaks separate items).
- **Parens required elsewhere:** call arguments (`f(a, b -> a + b)` could be one lambda or two
  arguments), `return` (`return v, w` is a multiple return), and one-line lists. Write
  `f((a, b) -> a + b)`.
- **Two arguments vs one of two values:** `"a", "b" -> …` takes two arguments; `"a" | "b" -> …`
  takes one that is either value.

**Zero params need `()`.** An arrow function with no params is written `() -> 123`, never
`-> 123`. A block body needs nothing: `{ … }` is already a function. This also covers members
(`@slug = () -> slug`).

## A Boolean subject is a compile error

Under a Boolean subject every Boolean head is a condition, so `bool |> [false -> …]` never fires
and `true -> …` always does: the clauses don't mean what they look like. Use `if`/`else`.

**Rule:** a Boolean input to a list that contains a pattern clause (one that matches its one
argument) is a compile error: "a Boolean is matched with if/else". A list of conditions only
ignores its input, so a Boolean there is harmless. "Boolean input" means a static type of
`Boolean` or a union including it. With an `Anything` input, a Boolean head is a condition, as
everywhere else.

## Open questions

- **Writes in a clause.** `"pgdn" { scroll <- scroll + PAGE; self }` writes the enclosing actor's
  cell from an anonymous function, which has no name to carry `!`. A clause list could take the
  union of its clauses' effects. Related: the `silent-lambdas` ticket.
- **`Function()` and `[]`.** Is `Function()` just an empty clause list typed as a function, so one
  of the two spellings can go?
- **Binding and a condition.** Elixir's `when`: a head that binds the value and tests it, such as
  `n (n > 10) -> …`.
