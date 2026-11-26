---
status: review
created: 2026-11-26
---
# Publish an in-process actor when it leaves

An actor built in-process (not through a `$new` message) isn't published, so when its address
leaves it goes out as garbage, on all three targets: JS `[{}]`, Erlang `[null]`, Rust
`["box__pub/1"]`.

```brevity
@Box = *{ @v = -> 7 }
@direct = {
  b = @Box()
  return b
}
```

The same holds for an actor built inside a class: one declared in the class block, and a
protected one declared in an instance body (open since
notes/session-2026-11-07-instance-type-authority.md, "a class's actor returned from an
instance"):

```brevity
A = *{
  @make = -> B()
} ^ {
  B = *{ @v = -> 7 }
}
Outer = *{
  Inner = *{ @v = -> 7 }
  @make = -> Inner()
}
@run = {
  a = A()
  return a.make()
}
@runOuter = {
  o = Outer()
  return o.make()
}
```

No test covers any of these.

An actor lives where its class is declared, whoever built it: building one is a `$new` to the
class, which answers relative to itself (`#<:N>`, `:`), and each level passes that on under its
label (notes/class-of-and-self-return-2026-11-23.md).

- **`@Box()` from anywhere** (the file, or a function of `w`) is `#<:Box:1>`, type `:Box`.
- **A class in a class block** (`B` in `A`'s): `#<:~A:~B:1>`, type `:~A:~B`. `B` answers
  `#<:1>`, `A`'s class passes it on under `~B`, the file under `~A`.
- **A protected class in an instance body** (`Inner` in `Outer`): under the instance,
  `#<:Outer:1:~Inner:1>`, type `:Outer:1:~Inner` (that instance's class); one more level
  (`Outer:1`) translates it.
- **Published lazily,** the first time it leaves (a reply, an arg, a cell), as `#_wireOwn` does
  for actors made by `$new`.

Tests, on all three targets: each case above. The nested ones pin the class answering `$new`
relative to itself.
