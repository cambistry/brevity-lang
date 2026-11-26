---
created: 2026-11-02
---
# Use injected actors' classes in place, and enforce bare vs. # headers

**Problem:** A bare header entry injects an actor you can message. A # entry is something you construct from. Three things don't follow from that today.

1. **A new actor has to be bound before it can be used.** These are compile errors ("Bind the new 'W' first"), though Svc is an ordinary injected actor and Svc.W() an ordinary message:

```brevity
*
  "svc.bv": Svc
*

@go = {
  return Svc.W().get()   // also: return Svc.W()   f(Svc.W()) – these should work
}
```

The refusal is a throw in src/public_classes.js:123. s.W() on a constructed s has the same limit. With that throw replaced by the existing lowering, the three forms compile on JS and Rust, but none of the output has been run. On Erlang, the chain crashes the compiler with a TypeError in erlString. W().get() from "svc.bv": (:W) already crashes the same way.

1. **The compiler doesn't distinguish the two header forms.** All of these compile under both headers, and the JS output sends the same #new to the same address:

```brevity
*
  "svc.bv": Svc      // or: "svc.bv": Svc #
*

@go = {
  s = Svc()          // should need #: Svc is already an actor
  w = Svc.W()        // should need a bare header: nothing to message under #
  return Svc.mk()    // same
}
```

public_class_across_files.test.js:43 relies on s = Svc() under a bare header.

1. **A qualified type with a value doesn't parse as a local annotation.** p Svc::Point = … fails with "Unexpected token in expression: EQUALS". p Svc::Point with no value parses, and qualified types work in params and fields. The lookahead in typeLength (src/parser.js:346) doesn't count ::.

**Decided:**

- **Svc::W for a class is refused.** :: names types, and classes use Svc.W(…). w W = Svc.W() is still how to annotate a local. Remove the alias::name branch in namesClass (src/public_classes.js:26).

**To check:**

- *_Svc () -> { … } headers:_ bang.test.js builds from them with Svc(), and the parser calls the form "explicit constructor + service". Decide whether it allows both uses or follows the # rules.
- **f(Svc.W()) at runtime:** f receives a remote address rather than an in-process handle, and passing an address as an arg is only partly worked out. Test what f can do with it, with both typed and untyped params.

**Done when:**

- Svc.W().get(), return Svc.W() and f(Svc.W()) compile and run on JS, Rust and Erlang, and s.W() works in the same positions.
- W().get() compiles and runs on Erlang.
- Svc() on a bare header is a compile error, and Svc.x() on a # header is a compile error, each with a clear message.
- public_class_across_files.test.js:43 uses "svc.bv": Svc #, then s = Svc() and s.W(), and other tests relying on the old behaviour are updated.
- p Svc::Point = … parses and resolves through Svc's doc, and a wrong qualified type is a compile error.
- w Svc::W = Svc.W() is a compile error that points to w W.
