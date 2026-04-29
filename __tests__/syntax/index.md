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
result Integer = double(5) |x Integer| { x * 2 }
```

They can follow normal positional/named arguments:

```brevity
result Integer = test(3, label: "hi") |n Integer| { n + 1 }
```

Multiple trailing blocks are appended in order:

```brevity
result Integer = both() |x Integer| { x + 1 } |x Integer| { x * 10 }
```

Lineal trailing blocks are also tested:

```brevity
result Integer = double(5)
  =
  x Integer
  =
  -> x * 2
```

## LLM Rules

- Use `//` for ordinary prose comments in generated examples.
- Use `---` block comments only when hiding a larger region.
- Use trailing blocks for callback-style function arguments.
- Prefer lineal trailing blocks when the block body is more than one expression.
