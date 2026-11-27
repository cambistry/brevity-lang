---
created: 2026-11-27
---
# Design: an annotation should construct its type from an initializer that isn't one

Want: in `x T = e`, if `e` is statically a `T`, `x` binds it; otherwise `x` is `T(e)`. The
annotation, not the right side, decides what `=` does. One rule, in a destructure too:

```brevity
p = Point(1, 2)
a *Integer, d Dir, q Point, r *Point = 123, "/path", (10, 20), p
```

- `a`: a new Integer cell holding 123 (`*Integer` is the cell's actor type).
- `d`: `Dir("/path")`, an actor.
- `q`: `Point(10, 20)`, a value.
- `r`: `p` is already a Point, so a new Point cell holding it.

Today: `count *Integer = 0` is the one case, a cell built from its initial value. Typed
destructures of plain values compile (`a Integer, b Text = 1, "x"`). These don't:

- `a *Integer, b Text = 1, "x"`: a cell in a destructure doesn't parse.
- `q Point = (10, 20)`: a bare tuple on the right doesn't parse.
- `c Counter = 5`: refused with "Cannot bind 'c Counter' to a value that is Integer. Annotate
  'c Integer', or coerce it with 'as Counter'". The suggested `5 as Counter` points at the same
  idea from the other side; reconcile the two.

Where it came from: `notes/file-views-and-codecs-2026-11-27.md` (being revised). There,
`tickets Dir[TicketFile] = "../tickets/*.md"` would read as sugar for
`tickets = Dir[TicketFile]("../tickets/*.md")`, and `ls Lines = ["a", "b"]` as `Lines([…])`,
which settles writing a plain `List[Text]` into a `Lines` view.

Decide:

- **What "already a T" means.** Statically typed as `T`, or a subtype. An untyped right side is a
  compile error, never a run-time choice.
- **Spawning is visible only through the annotation.** `x Dir = "p"` makes an actor, and nothing
  but knowing `Dir` says so. Is the capital letter enough, as with `*Integer`?
- **Several constructor arguments:** `x Dir[C] = (path: "p", watch: true)`, a tuple splatted into the
  constructor. Does a one-element right side splat or wrap?
- **`r *Point = p`:** the cell holds a copy of the value, not `p`'s identity. Does that hold when
  `p` is itself an actor?
- **Relation to `as`:** whether `x T = e` is `x = e as T` for every T, and so whether a codec's
  `from S` fires here (`ls Lines = someText`).
- **Write-side twin:** whether `x <- e` into a `*T` cell constructs by the same rule.
- **Every target:** js, erlang, rust.
