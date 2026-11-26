# The class of an address, and self-return — 2026-11-23

Decided in discussion, not implemented. Supersedes, in `opre-type-encoding-2026-11-21.md`,
`{ "%self": true }` and `":T:*"`; in `actors-not-classes-2026-11-18.md`, the self-return reply
(`ty: [':']` / `['*']`); in `opre-op-chains-2026-11-15.md`, "Compiler use".

## `*` is "the class of"

- **`X:*` is the class of `X`.** `:*` is my class.
- **Whoever knows `X`'s class reduces `X:*`,** to the class's address for an actor a `new`
  built, to `*` for a declared actor (a class, a singleton, a file). One that doesn't know
  passes it on; as it travels up, it translates like any address (`:*` from `:Box:1` is
  `:Box:1:*` to its host).
- **Bare `*` is the class of every declared actor.** `*:*` is undefined.
- **The instance needn't know its class.** Its host does, and a class that allocates instances
  elsewhere (another namespace, process, cluster) tells that host. Instances under their
  class is one placement, not an invariant.

## Replies

- **`$new` is answered by the class:** `{ re: ['#<:1>'], ty: [':'] }`. The `re` is wherever the
  instance lives; `:` is right because the replier is the class. Its parent translates both
  (`#<:Box:1>`, `:Box`).
- **An actor lives under its class, whoever asked for it** (2026-11-26). `@Box()` from a
  function of `w` is still `$new` to `Box`, so the file's callers see `#<:Box:1>`, `:Box`, never
  `w`'s path in front. This supersedes "the actor does live wherever it was constructed" in
  `session-2026-11-07-instance-type-authority.md`.
- **A class declared in a class lives where its declaration is** (2026-11-26). In the class
  block (`A = *{ … } ^ { B = *{ … } }`), the class itself, there is one `B`, under the class:
  `#<:~A:~B:1>`. In the instance body (`Outer = *{ Inner = *{ … } }`), `Inner` captures that
  instance's scope, so each instance has its own, under it: `#<:Outer:1:~Inner:1>`. It is still
  one code; only the address differs, but `Inner` of one instance is not `Inner` of another.
- **A class an instance declares is protected.** A public one there is a compile error, until
  `investigate-a-public-class-declared-in-an-instance` settles what it would mean.
- **Self-return is `{ re: ['#<:>'], ty: [':*'] }`,** from any actor. The bare `:` in `ty` meaning
  "the sender's class" is gone: `:` in `ty` is an address like any other.

An instance's self-return sends `ty: [':']`, which its host swaps
for the class tag (`localTy`, `classes.js`), and a declared actor sends `*`. Both give way to
the reduction rule.

## The service document

- **A type string names the class whose instance the value is.** `":T"` is an instance of `T`,
  as `":Point"` is a Point and `"Integer"` an Integer. `":T:*"` is retired: it was a node path
  standing in for a type, and assumed instances live under `T`.
- **The instance interface is an `instance` section** on the class's node, beside `public`:

  ```json
  ":T": {
    "extends": [":G"],
    "public":   { "$new": [{ "args": ["Text"], "re": [":T"], "writes": false }] },
    "instance": { "public": { "get": [{ "re": ["Integer"], "writes": false }] } }
  }
  ```

- **A declared actor as a value is `"*"`,** a class included, as on the wire. There is no
  class type: a class is an actor whose `$new` constructs.
- **A self-return's type is `":*"`, self's class** (2026-11-26, revising "`=> self` on an
  instance is `":T"`"). On the wire the reply is `re: ['#<:>']`, `ty: [':*']`, and the document
  types it the same: `"re": [":*"]`, the receiver's class wherever the op is called, so an op
  `Node` declares and `Element` inherits gives an Element on an Element. `{ "%self": true }` is
  retired; `":*"` is an ordinary type string, not a marker.

## Chains come from the source

A self-return form would let a compiler merge `a.x!(); a.y!()` into the chain `["x!", "y!"]`,
which is right only if `x!` returns `a` itself. It doesn't. `a.x!().y!()` is a chain, each step
on the last one's result, which needs only each result's class; `a.x!(); a.y!()` is two calls.
That's how they read. `actor = Class(); actor.tweak!(123)` is two calls too, and two
transactions.

Possible future option: an Opre clause carrying several ops against one address in one
message.
