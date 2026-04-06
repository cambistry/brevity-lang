# `over`

`over` maps a function across a list and returns a new list.

It is one of Brevity's core collection operators, and it reflects the
language's preference for explicit, structured transformations over general loop
syntax.

## The basic shape

```brevity
result List of Integers = over(nums) |item Integer| { item + 1 } as Integer
```

This says:

- iterate over `nums`
- apply the block to each `item`
- collect the results into a new list

That is the whole job of `over`.

## Why this matters

Brevity does not center its collection story on mutation-heavy loops. Instead,
it gives common transformation patterns names.

`over` is the "map" operation in that family. It is what you use when each
element should become another element and the overall list structure should be
preserved.

## Trailing blocks and function references

`over` works naturally with either:

- an inline trailing block
- a function reference written with `&`

Inline block:

```brevity
over(nums) |item Integer| { item + 1 } as Integer
```

Function reference:

```brevity
over(nums, &double)
```

That pairing is characteristic of Brevity. The language wants local ad hoc
logic and named reusable logic to feel like two expressions of the same idea,
not like two unrelated APIs.

## Type shape matters

Because Brevity is explicit about value shapes, `over` also carries type
information about the resulting list.

If you map integers to integers, you get a `List of Integers`.

If the block is left untyped, the runtime may still infer component shapes, but
the most legible use of `over` is the typed one: the transformation says what it
expects and what it returns.

## Why not a generic `for`

This feature reveals something about Brevity's design philosophy. The language
is not trying to provide one enormous, flexible iteration primitive and let
every pattern be expressed through it.

Instead, it names distinct collection operations:

- `over` for mapping
- `reduce` for folding
- `repeat while` and related forms for repeated control flow

That makes the intent of a list transformation visible immediately.

## `over` is about preserving shape

The easiest way to remember `over` is:

it walks the list, but it keeps the list-ness.

You are transforming elements, not collapsing the structure into one result.
That is what distinguishes it from `reduce`, and it is why `over` belongs in
the language at all rather than being a mere library helper.
