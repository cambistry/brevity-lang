---
created: 2026-11-27
---
# Fix: a bind inside an `if` used as a value should be checked

A typed bind is checked against its value in a function body (`t Text = n`, with `n Integer`, is a
compile error), but not inside a branch of an `if` that's a value:

```brevity
@f = (n Integer) {
  r Integer = if (n > 0) {
    t Text = n      // compiles
    1
  } else { 2 }
  return r
}
```

The same happens inside a clause list: its clauses lower to such an `if` chain
(`src/clause_lists.js`), so `x -> { t Text = x; 2 }` compiles though `x` is an Integer.

Expected: on js, erlang and rust, a branch body is validated as a function body is, with the names
around it in scope.

**Scope (2026-11-27):** bind checks reached only a body's top-level statements, so an `if` used as
a statement and a `repeat while` body were skipped too. Every nested block (an `if`'s branch, a
loop's body) is now validated as a body, and a clause's error names the binding as written.
