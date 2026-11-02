# Session 2026-11-01: constructing a public class from another file

A public class in another file can now be constructed and called, on js, Rust and Erlang.
Closes the gap listed in [the mutation-suffix session](session-2026-10-31-mutation-suffix.md).

## Decisions

**All three spellings, one message.**

```brevity
"svc.bv": (:W)      W()        // to: svc.bv @W
"svc.bv": Svc       Svc.W()    // to: Svc @W
s = Svc()           s.W()      // to: <s's address> @W
```

`Svc.W()` asks the shared actor and `s.W()` asks that instance. `(:W)` is shorthand for the
first.

**`#new` with the class as its selector,** matching `HTML @div` and constructing a file. The
doc types `W` as a constructor, which is how a caller knows to send `#new` rather than `@W`. A
class named with `!` keeps its literal name: `Svc @W!`.

```
→ { id: "1", op: [[5, { step: 2 }], "#new"], to: "Svc @Counter" }
← { id: "1", re: "#<@Counter/1>", 'bv-a': "#<@Counter>", to: "caller" }     // the parent makes it #<Svc @Counter/1>
→ { id: "2", op: "@get", to: "Svc @Counter/1" }
← { id: "2", re: [5], to: "caller", from: "@Counter/1" }
```

- **The address is local form.** The constructing actor doesn't know its own name, so its parent
  promotes `#<@Counter/1>`, as with any other local address.
- **A sub-actor's reply has a `from`,** since it isn't the file actor answering.
- **`W!` counts as a write for its caller.** A class without `!` doesn't, since creating an actor
  isn't a write.
- **Annotations name the class without `!`:** `w W = Svc.W!()`. No `as` is sent, because the
  annotation names what's being constructed.
- **Only public classes answer.** `#new` for a private class is `unhandled`.
- **`#new` isn't gated on tags.** Other ops with a payload need `bv-a`, or they're refused as
  `schema_required`. `#new` has never carried one, and a caller's args are checked against the doc.

## Code

- **`src/public_classes.js`:** `lowerPublicClassCalls` turns each spelling into a dependency of its
  own, with `wireTarget` as its address, so every backend's existing construction path handles it,
  including at file level. `s.W()` adds the receiver's address at runtime (`viaInstance`).
  `addConstructHandlers` adds `new@W` to the file actor, after effects, so it stays out of docs and
  effect checks.
- **`new@W` works like `set@a`:** `#new` plus a selector normalizes to `new@W`, on all targets.
- **Routing:** a message whose `to` holds a registered address (`@W/1`) goes to that actor. Each
  backend registers only actors made through `#new`, so an actor the file made for itself can't be
  reached by guessing its address.
- **Lexer:** `:W!` lexes, for `(:W!)`.
- **`useBareClassNames`** records `isPublic`, since it strips the `@` that said so. *Replaced by
  `renamePublicClasses`: see [session-2026-11-02-at-names](session-2026-11-02-at-names.md).*
- **`(:W)` stays in the destructure list,** flagged `isClass`, because a template's `<W>` is checked
  against that list, and collisions are still reported. It isn't a destructured member any more.
- **The DOM takes the same path:** `div()` from `HTML: (:div)` now sends `#new` to `HTML @div`, which
  is what the runtime's `handleDomNew` expects. It used to send a `@div` call.
- **Constructor args check:** `validateConstructorCall` dropped `? ` from doc params and compared
  unions by exact string, so `hidden: Boolean | Text` refused a Boolean. Nothing had reached it with
  a doc class before. A class's params now include its ancestors', wherever they're declared.

## Bugs fixed on the way

- **Erlang:** a statement call on a dependency actor held in a local (`w.inc!()`) sent
  `to: "w"`, the variable's name, and didn't wait for its reply. Reads then overtook writes.
- **JS test harness:** `runActors` didn't split `"Svc @W"` into alias and selector, or promote
  local addresses as a parent does.

## Tests

`__tests__/classes/public_class_across_files.test.js`: both sides on the wire, the checks, and two
compiled files talking through a relay in the test, on every target. The relay goes one message at a
time, because Rust replays its whole input on each send and a caller blocks on each call.

## Known gaps

- **`Svc.W()` must be bound first.** `Svc.W().get()` and `return Svc.W()` are compile errors. A
  header-bound `W()` can be used in place, on every target.
- **`s.W()` at file level is a compile error,** since `s` has no address yet during init.
- **Replies on Rust and Erlang have no `bv-a`.** A class's arms don't pass one to their parent in
  process. Scalars arrive fine; a Type value returned from a class across files arrives untagged, so
  the caller can't decode it. JS is unaffected.
- **Type values as constructor args.** `#new` carries no tags, so `Svc.W(Point(1, 2))` has nothing
  to decode by on the receiving side.
- **`w Svc::W` as a local annotation doesn't parse,** for any type. Only `x W` works, and that needs
  `W` to resolve, which it does through the doc.
- **Local instances aren't member-checked with an inline dep.** `t = Thing(); t.nope()` inside a
  function compiles. Existing behaviour; a class reached by these spellings is checked.
- **A class can't read its file's cells.** `total *Integer = 4` with `@get = { return total }` in a
  class fails at runtime on js. Existing behaviour, and it means nothing distinguishes `Svc.W()`
  from `s.W()` yet except which actor holds the new one.
