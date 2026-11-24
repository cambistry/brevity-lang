---
status: done
created: 2026-04-16
---
# custom types in interfaces

An interface document must remain process-agnostic, i.e. cannot depend on the type-awareness and/or aliasing that is INTERNAL to it’s generating constructor. Therefore, TYPES _must_ be documented as addresses - either service/instance addresses or constructor addresses. This is done with backticks:

```
{
  next: (`DOM`.Element) -> (`DOM`.Element | null)
}
```

Example (without HTML baggage):

pair.bv:

```
<:key Text, :value Text> // defines a type shape
```

app.bv:

```
<"pair.bv": (Pair) *> {
  @a = -> Pair(key: "1", value: "A")
  @b = -> Pair(key: "2", value: "B")
}
```

From it’s coordinates, “pair.bv” is the address of the type. (Note that pair.bv is also the actual HOST of a Pair instance.) So the service document of pair.bv is:

```
<:key Text, :value Text> -> {
  key: () -> (Text)
  value: () -> (Text)
}
```

But what is the interface of app.bv (as a service)? It can’t be

```
{
  a: () -> (Pair)
  b: () -> (Pair)
}
```

because a consumer doesn’t necessarily know – can’t know – what is meant by `Pair`. So the path actually needs to be explicit:

```
{
  a: () -> (`pair.bv`)
  b: () -> (`pair.bv`)
}
```

This will also work for types defined in the public interface of a file:

geometry.bv

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

app.bv:

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
