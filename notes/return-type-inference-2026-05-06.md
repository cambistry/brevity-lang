# Return-type inference — one-hop bound

Date: 2026-05-06

Status: **decided**, not yet implemented. Concrete bound on what the compiler will and won't infer when a function declares its return type with `:`.

## The setup

`as` is for runtime coercion only. A function's declared return type uses `:`:

```
fn = (a) { a * 2 } : Integer
```

`fn = (a) { a * 2 } as Integer` is a parser error.

The declaration `: Integer` is a constraint on the body's tail expression. Because `2: Integer` and the result must be `Integer`, the param `a` is constrained to `Integer`. Calling `fn(1.5)` should be a compile error.

The question: how far does the compiler chase that deduction?

## The bound: one-hop

Inference runs only when the tail expression is a **pure operator tree** whose leaves are params or typed literals, and whose root type unifies with the declared return.

The compiler does **not** follow function calls, enter branches, walk let-bindings, or recurse. Anything outside the tree shape kicks back with "can't infer `a`; annotate it."

### Solves

- **Identity** — `{ a } : T` → `a: T`
- **Op vs. typed literal** — `{ a * 2 } : Integer` → `a: Integer`
- **Nested ops, all leaves typed** — `{ a * 2 + 1 } : Integer` → `a: Integer`. Still inside the bound: single expression tree, no calls/branches.
- **Multi-param, all constrained** — `{ a + b } : Integer` with `+` monomorphic per target type → both `Integer`

### Kicks back

- **Any call in the tail** — `{ f(a) } : T`. Would require chasing `f`'s signature; explicitly out of scope.
- **Conditional or branching tail** — `{ if a > 0 { 1 } else { -1 } } : Integer`. `>` tells you `a` is comparable; joining across branches is more than one hop.
- **Let-bindings or sequencing** — `{ x = a; x * 2 } : Integer`. The param-to-tail path crosses a binding.
- **Recursion or self-reference** — circular constraints; bail.
- **Polymorphic operators that don't pin operands** — `==` returns `Boolean` regardless of operand type; tells you nothing about `a`.
- **Mixed** — any param the constraint tree leaves free, even if its siblings solve. All-or-nothing per call, not per param.

## Why this bound

Full backward inference (HM-style constraint unification across calls, branches, and bindings) is doable but expensive across three targets (JS, Rust, Erlang) and produces unification errors that point three calls deep instead of at the user's code.

One-hop:

- Reuses the machinery already needed to verify the body matches the declared return.
- Keeps failure mode local: the error names a specific param, on the function the user just wrote.
- Captures the easy wins (the `a * 2` case the question started from) without dragging an inferencer into v1.

The escape hatch is always to annotate the param: `(a: Integer) { ... } : Integer`. The bound just decides when annotation is required.

## Error shape

When inference kicks back, the error should say:

```
Cannot infer type of param `a` from return type `Integer`.
Annotate it: (a: Integer)
```

Not "unification failed." Not "type variable escaped its scope." The user's recovery is always the same — write the annotation — so the message should say so.

## Open

- Does **field access** in the tail count as a call? `{ a.x } : Integer` requires knowing `a`'s shape, so it kicks back. Confirmed out of scope for v1.
- What about **type-class-style** numeric literals — does `2` commit to `Integer` or stay polymorphic until constrained? For v1, treat numeric literals as monomorphic per their syntax (`2` is `Integer`, `2.0` is `Float`); revisit if it bites.
- Interaction with **generic-by-`of`** params (`List of T`) — deferred; one-hop assumes monomorphic targets and the `of`-generic story is separate.
