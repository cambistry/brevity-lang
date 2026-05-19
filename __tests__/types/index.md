# Types and Shapes

LLM orientation: this directory is the current test-backed source for Brevity's
type declaration and shape-value work.

## Current Syntax

Declare a shape type:

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

- Shape declaration parsing and validation.
- Shape construction with positional and named fields.
- Field access on typed shape values.
- Shape equality and tag-aware comparison.
- Shape destructuring, including optional fields and fallback.
- Shape wire format with `::Tag` annotations.
- Cross-module type references such as `Geom::Point`.
- Type coercion, dependencies, matching, unions, and actorization.

## Wire Notes

- Tagged shape values use `::Type` annotations in `bv-a`.
- All-required positional shapes can travel as positional payloads.
- Optional-bearing shapes can travel as named maps with absent optional fields
  omitted.

## LLM Rules

- Use `::Name = (...)` for shape (type) declarations.
- Use `Name(args)` for value construction.
- Do not confuse values with actors. A `Point(1, 2)` is a value; `*Point(1, 2)`
  is an actor with the same shape.
- Field access on shape values is local, not a CAM message hop.
- Use `*Name(args)` when constructing an actor rather than a value.
