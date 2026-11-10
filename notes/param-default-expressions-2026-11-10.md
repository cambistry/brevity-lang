# Param defaults take expressions — 2026-11-10

A param default (class or function) was a literal only: `(b Integer = 3)`.
It is now any expression: `(b Integer = 1 + 2)`, `(end Integer = start + 10)`.

## Rules

- **Where it runs: the callee.** A class's defaults run in its constructor,
  before the constructor block; a function's run at the start of its body.
  The caller only learns that the arg is optional. This is where literal
  defaults already ran on every target.
- **What it sees: anything in scope there** — every param (left or right of
  it), file-level names, imports.
- **Order.** Every supplied arg is bound first. Then the defaults of omitted
  args run in dependency order: a default naming another defaulted param runs
  after that param's default. A cycle (`(a Integer = b, b Integer = a)`) is a
  compile error.
- **Type.** A literal default still gives an untyped param its type
  (`b = 3` is `b Integer`). Any other default needs the type written:
  `b = 1 + 2` is an error; `b Integer = 1 + 2` is fine.
- **Interface.** Unchanged: a param with a default renders as `?`
  (`U (? Integer) -> *{}`). The default is the class's business, not part of
  the contract.
- **Negative literals.** `= -1` is a literal (folded at parse time). There is
  no unary minus in expressions yet, so `= -1 + 2` is not.

## `++`

A default comes after `=`, so a `+` inside it is never read as `++`:
`(A ++ n Integer = 1 + 2)` is parent `A`, then param `n`.

## Shorthand

The named shorthand `name: literal` (`(b: 3)`) stays literal only; `name: X`
already means "type or local" there.
