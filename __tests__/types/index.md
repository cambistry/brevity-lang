# Types

LLM orientation: this directory is the current test-backed source for Brevity's
type declaration and type-value work.

## Current Syntax

Declare a type:

```brevity
::Point = (x Integer, y Integer)
```

Construct a value:

```brevity
p Point = Point(1, 2)
```

Access fields locally:

```brevity
@get_x = -> result: Point(7, 8).x as Integer
```

Use unions:

```brevity
value Integer | Text = 1
maybe Text | null = null
```

## Tested Areas

- Type declaration parsing and validation.
- Type construction with positional and named fields.
- Field access on typed values.
- Type equality and tag-aware comparison.
- Type destructuring, including optional fields and fallback.
- Type wire format with `::Tag` annotations.
- Cross-module type references such as `Geom::Point`.
- Type coercion, dependencies, matching, unions, and actorization.

## Wire Notes

- Tagged type values use `::Type` annotations in `bv-a`.
- All-required positional types can travel as positional payloads.
- Optional-bearing types can travel as named maps with absent optional fields
  omitted.

## LLM Rules

- Use `::Name = (...)` for type declarations.
- Use `Name(args)` for value construction.
- Do not confuse values with actors. A `Point(1, 2)` is a value; `*Point(1, 2)`
  is an actor with the same shape.
- Field access on type values is local, not a CAM message hop.
- Use `*Name(args)` when constructing an actor rather than a value.
