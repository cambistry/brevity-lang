# Syntax

LLM orientation: this directory covers comments, trailing blocks, and small
syntax smoke tests.

## Comments

Line comments:

```brevity
// comment
-- comment
-- labeled separator --
```

Block comments use dash fences:

```brevity
---
ignored source
---
```

Four-dash fences are also accepted.

Comments inside lineal parameter sections are transparent; they do not become
the `=` separator between params and body.

## Trailing Blocks

Trailing blocks are appended as positional function arguments:

```brevity
result Integer = double(5) (x Integer) { x * 2 }
```

They can follow normal positional/named arguments:

```brevity
result Integer = test(3, label: "hi") (n Integer) { n + 1 }
```

Multiple trailing blocks are appended in order:

```brevity
result Integer = both() (x Integer) { x + 1 } (x Integer) { x * 10 }
```

Lineal trailing blocks are also tested:

```brevity
result Integer = double(5)
  =
  x Integer
  =
  return x * 2
```

## Names

Every name in value position is bound, or the compile fails with
`'x' is not defined (line N)`. A local is bound from its line on. A cell, a
function, a class, a type and a `use` binding are bound everywhere in their
scope, so a function may call one declared below it. A class reaches the names
of the actors it's declared in. A param or binding shadows a builtin namespace
(`(Math Integer)`).

When a bare name is unbound but its other form is bound, the message names it:
`'a' isn't in scope — the published cell is '@a'`, `the public function is '@h'`,
`the function is '#h'`, or `the silent 'fire.' is called 'fire(…)...'`.

## Type names

Every name in type position is a type, or the compile fails with
`'X' is not a type`: in annotations, params, returns, cell types, after `of`,
in unions, in function types (not their field names), in `::` paths,
constructor profiles and documents written in the file. A type is a builtin
(a plural only after `of`), a `type` the file declares, a class (a writing
class `W!` types its actors `W`), `class`, an actor a dependency injects, or a
type or class a dependency's document declares, bare or through it
(`Svc::Point`). With no document there is nothing to reach `Svc::Point`
through.

## LLM Rules

- Use `//` for ordinary prose comments in generated examples.
- Use `---` block comments only when hiding a larger region.
- Use trailing blocks for callback-style function arguments.
- Prefer lineal trailing blocks when the block body is more than one expression.
