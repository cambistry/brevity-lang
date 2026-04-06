# `reduce`

`reduce` combines a list into a single accumulated result.

Where `over` preserves the list shape, `reduce` intentionally collapses it.
That makes it the natural tool for totals, products, summaries, and other
stateful traversals over a collection.

## The basic shape

With an explicit initial value:

```brevity
result Integer = reduce(0, nums, &add)
```

Or with a trailing block:

```brevity
result Integer = reduce(1, nums) |acc Integer, item Integer| { acc * item } as Integer
```

The meaning is:

- start with an accumulator
- combine it with each item in turn
- return the final accumulator

## With and without an initial value

Brevity supports both:

- `reduce(init, list, fn)`
- `reduce(list, fn)`

When no explicit initial value is given, the first list element becomes the
starting accumulator. That is why reducing an empty list without an initial
value yields `null`: there is no element available to seed the reduction.

That behavior makes the no-initial form convenient, but it also makes its type
shape more conditional.

## Why `reduce` exists as a language form

Like `over`, `reduce` reflects a design preference: common collection
operations should be named directly rather than rebuilt from lower-level loop
machinery every time.

This makes code easier to read. A reader seeing `reduce` already knows the broad
shape of the computation:

- one pass through a collection
- one evolving accumulator
- one final result

## Function references and inline blocks

`reduce` works with both reusable named functions and inline block logic.

That matters because reductions are often poised between:

- domain-specific operations that deserve a name
- one-off local folds that are clearest in place

Brevity gives both forms equal footing.

## Why `reduce` is distinct from ordinary mutation

A reduction may feel stateful, but the accumulator is not the same thing as a
mutable outer variable. The evolving value is part of the reduction's own
structure.

That distinction is useful because it keeps list folding legible. The reader can
see that the accumulation belongs to this traversal, rather than having to
inspect the wider scope for side effects.

## A small center of gravity

`reduce` is one of the clearest examples of Brevity's broader collection style:

- use a named form for a named intention
- keep transformation patterns explicit
- let the syntax support both compact and spacious styles

It is not just a convenience. It is part of the language's effort to make
common data-flow patterns look like themselves.
