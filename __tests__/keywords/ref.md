# `ref`

`ref` introduces mutable cells into Brevity's otherwise value-oriented local
scope model.

The syntax uses `*`, but `ref` is not only about mutation. It is about making
shared, updatable state explicit wherever the language permits it.

## A mutable binding, not a rebinding

The simplest form is:

```brevity
count *Integer = 0
```

That does **not** mean "declare a variable that may later be rebound with `=`."
It means "declare a reference cell whose current value is an `Integer`."

Updating that cell uses `<-`:

```brevity
count <- count + 1
```

This distinction is important. Brevity separates:

- binding a name
- mutating a reference cell

That keeps mutation explicit.

## Why `ref` exists

Actors often need state that evolves over time:

- counters
- last-seen values
- cached data
- accumulators

Without `ref`, every local change would need to be modeled as purely functional
value threading or actor restructuring. `ref` gives the language a direct way to
say "this value is stateful."

## `ref` and lexical scope

A `ref` declared in one scope can be read or updated from nested scopes:

```brevity
count *Integer = 0

inc = { count <- count + 1 }
```

That makes `ref` cells the natural bridge between local helper functions and the
state they cooperate on. The tests in this area show reads and writes happening
across `if` branches, local functions, and loops.

This is one of the reasons `ref` matters so much in practice: it gives closures
a disciplined shared-state mechanism instead of forcing all outer-scope mutation
to become implicit rebinding.

## Pass-by-reference

`ref` also supports explicit reference passing:

```brevity
@bump
  =
  x *Integer = 0
  inc = |target *Integer| { target <- target + 1 }
  inc(&x)
  -> result: x
```

The `&` marker matters here. It says that the caller is passing the reference
itself, not merely the current value stored inside it.

That keeps mutation visible at the call site as well as at the definition site.

## Why Brevity does not just use ordinary mutable variables

The language could have allowed ordinary names to be reassigned freely. It does
not. Instead, it reserves mutation for explicit reference cells.

That has two advantages:

- readers can tell which bindings are intended to vary over time
- accidental mutation stays harder to smuggle into code that looks value-based

So `ref` is not just a convenience feature. It is part of the language's
discipline around state.

## `ref` and actor thinking

Even in local code, Brevity wants state changes to be visible and intentional.
That is in harmony with the broader actor model, where state is not incidental
ambient data but something owned and updated in a controlled way.

`ref` gives local scopes a version of that same explicitness.
