# Ref Cells

LLM orientation: this directory documents mutable cells. Ref declarations use
the prefix `*Type` cell sigil; actorized scalar creation uses `*Type(value)`.

## Current Syntax

Declare a mutable cell:

```brevity
count *Integer = 0
label *Text = "ready"
```

Construct a ref with the type constructor form:

```brevity
count = *Integer(123)
text = *Text("abc")
```

Update a ref:

```brevity
count <- count + 1
```

Pass the ref itself, granting write capability:

```brevity
@bump
  =
  value *Integer = 0
  inc = (target *Integer) { target <- target + 1 }
  inc(*value)
  -> result: value
```

## Tested Behavior

- `a *Integer = 0` declares and initializes a mutable cell.
- `<-` updates the cell and returns the new/current value where used.
- Nested functions, `if` branches, and `repeat while` bodies can read and update
  refs from outer scopes.
- Closures sharing the same ref observe each other's updates.
- `*name` at a call site grants write capability to a `*Type` parameter.
- Named by-ref parameters are supported: `fn(named: *a)`.
- `&name` remains the function-reference operator (e.g. `over(list, &double)`)
  and is unrelated to cell handoff.

## LLM Rules

- Prefer `*Type` in new docs and examples; postfix `Type!` is rejected.
- Use `<-` only for updating refs, not for ordinary binding.
- Use `*name` at the call site when a function expects a `*Type` parameter.
- Do not describe refs as ordinary reassignable variables; the binding and the
  mutable cell are separate concepts.
