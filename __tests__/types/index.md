# Types

LLM orientation: this directory is the current test-backed source for Brevity's
type declaration and type-value work.

## Current Syntax

Declare a type:

```brevity
type Point (Integer, Integer)
```

Construct a value:

```brevity
p Point = Point(1, 2)
```

Read positional fields by destructuring, named fields by name:

```brevity
type Pair (x: Integer, y: Integer)
@first = {
  (a, b) = Point(7, 8)
  return result: a
}
@get_x = -> result: Pair(x: 7, y: 8).x
```

Use unions:

```brevity
value Integer | Text = 1
maybe Text | null = null
```

## Tested Areas

- Type declaration parsing and validation.
- Type construction: positional args fill positional fields, named args named fields.
- Field access on typed values (named fields only).
- Type equality and tag-aware comparison.
- Type destructuring, including optional fields and fallback.
- Type wire format with `authority Name` tags.
- Cross-module type references such as `Geom::Point`.
- Type coercion, dependencies, matching, unions, and actorization.

## Wire Notes

- Tagged type values use `authority Name` tags in `ty`.
- A typed value travels as a list: its positional values, then its present
  named values in one trailing object. Absent named fields are omitted.

## LLM Rules

- Use `type Name (...)` for type declarations.
- Use `Name(args)` for value construction.
- Do not confuse values with actors. A `Point(1, 2)` is a value; `*Point(1, 2)`
  is an actor with the same shape.
- Field access on type values is local, not a CAM message hop.
- Use `*Name(args)` when constructing an actor rather than a value.
