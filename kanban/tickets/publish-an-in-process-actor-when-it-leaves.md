---
status: inbox
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

The same holds for an actor an instance builds (open since
notes/session-2026-11-07-instance-type-authority.md, "a class's actor returned from an
instance"):

```brevity
A = *{
  B = *{ @v = -> 7 }
  @make = -> B()
}
@run = {
  a = A()
  return a.make()
}
```

No test covers either.

Open, to settle first:

- **Address.** It lives where it was built: a `Box` built by `w` (`W:1`) is `#<:W:1:Box:1>` to
  the file, its class's `#<:N>` translated once per level on the way out
  (notes/class-of-and-self-return-2026-11-23.md, `$new` answered by the class).
- **Tag.** The 11-07 note gives `:Box` relative to the file (no `W:1` in front), since `@Box` is
  the file's class. Plain translation would give `:W:1:Box`. The 11-23 `X:*` reduction ("whoever
  knows X's class reduces it") looks like the answer; nothing implements it yet.
- **When.** Published lazily, the first time it leaves (a reply, an arg, a cell), as `#_wireOwn`
  does for actors made by `$new`.

Tests, on all three targets: both cases above, and one where the reply is translated at more
than one level, which pins the class answering `$new` relative to itself.
