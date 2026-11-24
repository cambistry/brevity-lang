---
status: done
created: 2026-04-17
---
# Destructuring in DI

Public functions can be destructured from injected services.

Can be done with the destructure sigil.

```
<
  DOM: (:Element, :div, :p)
>
```

or be aliased:

```
<
  Service: (Func: fn, CONFIG: cfg Text)
>
```

‌

Full example:

[geometry.bv](http://geometry.bv/ "‌")

```
<> {
  @Point = <x Integer, y Integer>
}
```

service:

```
{
  Point: <Integer, Integer> -> {
    x: () -> Integer
    y: () -> Integer
  }
}
```

[app.bv](http://app.bv/ "‌"):

```
<"geometry.bv": (:Point) *> {
  x *Integer = 0
  y *Integer = 0
  @assign = |p Point| {
    x <- p.x
    y <- p.y
  }
  @coordinates = -> Point(x, y)
}
```

service:

```
{
  assign: (`geometry.bv`.Point) -> .
  coordinates: () -> (`geometry.bv`.Point)
}
```
