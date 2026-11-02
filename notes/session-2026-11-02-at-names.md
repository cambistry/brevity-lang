# Session 2026-11-02: `a`, `@a` and `#a` are different names

Inside an actor, `a`, `@a` and `#a` are different labels, for functions and classes alike. Outside,
only `@a` is exposed. It's `@a` on the wire, and a caller's Brevity consumes it as `.a`.

This supersedes two earlier decisions: public classes constructed by their bare name, and a bare
name reaching a public function.

## Behaviour

```brevity
@Box = *{ @who = -> "public" }
Box = *{ @who = -> "private" }      // allowed: a different class

a = @Box()                          // the public class
b = Box()                           // the private class
c @Box = @Box()                     // @Box as a type
@Sub = (@Box |) *{}                 // @Box as a superclass
@f = (b @Box) { … }                 // @Box as a param's type
```

- **A bare name reaches nothing else.** `Box()` with only `@Box` declared is a compile error:
  `'Box' isn't in scope — the public class is '@Box'`. The same goes for `f()` beside `@f` or `#f`,
  `W!()` beside `@W!`, `(Box |)`, and `b Box`.
- **`#new` is unchanged.** `#new` to `@Box` constructs the public class, and registers `@Box/1`.
  `@Box()` doesn't register anything, so its actor can't be reached by guessing an address.
- **Docs are the outside view,** so they name the class `Box`, with no `@`. A doc lists only public
  classes, so nothing collides with a private `Box`.
- **`(:W)` and `Svc.W()` are unchanged.** They name what the doc lists.

## Decisions

- **A class's own `@x` comes first.** Inside a class with its own `@Box` function, `@Box()` calls
  that function, not the file's class.
- **A class and a function can't both be file-level `@Box`.** `@Box()` couldn't say which it meant, so
  it's a compile error.
- **`W` beside `W!` is still an error, and `@W` beside `@W!`.** Different effects need different
  names. `W` beside `@W!` is fine: those are different names anyway.
- **`(@T* |)` has to name its binding:** `(@T *t |)`. The short form binds the class's own name, and
  `@T` as a local would read as a self-call.

## Code

- **`renamePublicClasses`** (`src/subclass.js`, replaces `useBareClassNames`) runs at the top of
  `compile()`. It gives each public class the identifier `Box__pub`, in every reference, since
  backends can't emit `@Box`. Nothing in a file can collide with it unless it's written out.
  Selectors keep the source name, in `selector`, so the wire is unchanged.
- **Compile errors** turn `Box__pub` back into `@Box` (`validateWithSourceNames`).
- **Wire visibility:** an unregistered instance's internal class name changes to `Box__pub`. It isn't
  part of any address a caller can use.
- **Bare-name check:** `checkBareCalls` and `checkTypeNames` in `lowerSelfChains`, where the old
  rewrite was. They also cover file-level and constructor bodies.
- **Exact lookups:** `overloads` in `chains.js`, `calleeParams` and `isReadCall` in `effects.js`,
  `functionsByName` in `validate.js`. A return-shape error now says `'@f()'`.
- **Backends:** the Rust and Erlang `publicFnNames` fallbacks, which sent `f()` to `@f` even with a
  private `f` declared, are gone.
- **Parser:** `@Name` in `parseAtomicType`, `typeLength`, supertype prefixes and param types.
- **Bang classes** match on the full name, `@W!`.
- **Rust routing:** a registered address names the selector, so `@Box/1` routes to the `box__pub` child.
- **Rust, on the way:** `t Text = inner.who()` on a wrapped superclass didn't compile. It only worked
  destructured.

## Two older bugs, fixed here

- **Passing an actor to a function:** `@takes(@Box())` failed on every target, with a private class too.
  Inside one actor, each backend already hands the instance over by value: a handle on js, a pid on
  Erlang, `box__pub/1` on Rust. A param typed as a class of the file now counts as holding one of its
  actors, on Rust and Erlang, as a local does. On js, `BvObject.one` passes an actor through. On Rust,
  a local passed this way is cloned, so the caller can keep using it.
- **`f` and `#f` answered from outside.** All functions go through dispatch as self-sends, and nothing
  checked the sender. A private function's arm now only matches an in-process sender, on file actors
  and instances. Outside it's `unhandled`.

## Open

- **An actor's address as an arg from outside.** A param typed `@Box` only holds an in-process actor.
  A remote caller has no way to tag one, since the wire tag isn't defined for a class.
- **Rust's address numbers aren't only `#new`'s.** They come from the shared instance id, so `#new`
  after two `@Box()` calls answers `@Box/3`, where js and Erlang answer `@Box/1`. Nothing registers the
  others.
- **`untracked` is still by bare name** in `effects.js` (`untrackedNames`), so `untracked a` also
  exempts `@a`.
- **`Box` as a plain value,** not a call, with only `@Box` declared isn't checked at compile time.
