---
created: 2026-04-25
---
# Types! `::`

Communicable shapes.

geometry.bv

```
::Point = (x Integer, y Integer)
```

location.bv

```
<"geometry.bv": (:Point)>
=
@coords Point! = (0, 0)
@shift = |x Integer, y Integer| {
  origin <- (origin.x + x, origin.y + y)
  .
}
```

app.bv

```
<
  "geometry.bv": (:Point),
  "location.bv": Location
>
=
Location.coords == Point(0, 0)
Location.shift(1, 2)
Location.coords == Point(1, 2)
```

on the wire:

```
{op: "coords"}
{re: [[0, 0]], bv-a: ['#<geometry.bv ::Point>']}
{op: [[1, 2], "shift"], bv-a: [[Integer, Integer]]}
{op: "coords"}
{re: [[1, 2]], bv-a: ['#<geometry.bv ::Point>']}
```
