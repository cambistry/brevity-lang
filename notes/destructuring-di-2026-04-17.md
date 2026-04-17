# Destructuring in DI

Public members can be destructured from injected services using the `:` sigil
in the import declaration. From the client's perspective these are all the same
thing: addressable ops.

## What can be destructured

- **Functions**: `@greet = |name Text| -> "hello " + name`
- **Constants**: `@pub = "magic"`
- **Cells**: `@value *Integer = 1`

All three are public (`@`-prefixed) and all three are addressable ops at the
service boundary — the consumer doesn't know or care which flavor it got.

## Syntax

Destructure with the `:` sigil inside the import tuple:

```
< DOM: (:Element, :div, :p) >
```

Aliased destructuring:

```
< Service: (Func: fn, CONFIG: cfg Text) >
```

The left side of `:` is the local alias; the right side is the name in the
source service. Type annotations can follow.

## Full example

### geometry.bv

```brevity
<> {
  @Point = <x Integer, y Integer>
}

service: {
  Point: <Integer, Integer> -> {
    x: () -> Integer
    y: () -> Integer
  }
}
```

### app.bv

```brevity
<"geometry.bv": (:Point) *> {
  x *Integer = 0
  y *Integer = 0

  @assign = |p Point| {
    x <- p.x
    y <- p.y
  }

  @coordinates = -> Point(x, y)
}

service: {
  assign: (`geometry.bv`.Point) -> .
  coordinates: () -> (`geometry.bv`.Point)
}
```

Here `:Point` destructures the `Point` constructor from the geometry service,
making it available directly in the body without qualifying through the
service reference.
