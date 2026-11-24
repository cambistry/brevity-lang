---
status: inbox
created: 2026-11-03
---
# Replace caller-based type inference for actor params

**Problem:** inferActorParams (src/public_classes.js) gives an untyped param of a private function a class type when every caller it finds passes an actor of that one class from the same file.

```brevity
@Box = *{ @who = { return "x" } }

read = (b) { return b.who() }     // treated as (b @Box)

@go = { return read(@box()) }
```

It was added during the injected-actors work (notes/session-2026-11-02-injected-actors-in-place.md) without a design decision. An actor from the same file arrives as a local handle, and a remote one as an address. JS checks which at runtime, in #childSend. Rust and Erlang decide at compile time, and treat an untyped param as an address unless inference applies.

**Why it needs replacing:**

- **It conflicts with an existing decision:** private functions are generic by default, and this quietly makes them specific.
- **A distant edit can break working code:** a second caller passing a different class or an address turns inference off. read(@box()) then stops working on Rust and Erlang with no compile error, while JS keeps working.
- **It doesn't see every caller:** it only reads function bodies, so it misses calls from a constructor block and functions passed as values, like &read. A missed caller passing an address could be sent down the in-process path.
- **It only recognises some arguments:** a direct Box(), or a local assigned from one with a plain =. An actor in a cell or a typed local turns inference off.
- **It barely has tests:** two cases in public_class.test.js cover where it works, and none cover the cases above.

These come from reading the code. The failure cases haven't been run, so reproduce them first.

**Options:**

1. **Runtime check on Rust and Erlang, as on JS (recommended):** the function stays generic, and no call site affects another. Erlang looks easy, since a handle is a pid. Rust is unscoped, because a handle like box/1 is a string that looks like an address, so handles may need a distinct representation.
1. **Require an annotation:** remove inference, so a local actor needs (b @Box), and an untyped param receiving one is a compile error. This is small and predictable, but less generic, and JS would refuse something it can do.
1. **Keep inference and refuse what it can't resolve:** make mixed callers a compile error. This removes the silent failure, but the type still depends on callers, and the function-value hole stays unless that's refused too.

If option 1 proves too expensive on Rust, fall back to option 2 rather than keep inference, because option 2 fails at compile time.

**To decide:** Option 1, 2 or 3, after scoping the Rust work.

**Done when:**

- A function's param handling doesn't depend on which other callers exist, or the compiler refuses the cases it can't resolve.
- Tests cover these on JS, Rust and Erlang:
- an in-process actor passed to an untyped param, directly and from a local
- an actor from a cell or a typed local
- callers passing different classes
- one caller passing an in-process actor and another passing an address
- a call from a constructor block
- a function passed as a value
- If inference is removed, inferActorParams is gone and the existing tests in public_class.test.js still pass, or are annotated under option 2.
- The session note describes the final behaviour.
