# "Self becomes" — constructor tail-return as structural interface extension (2026-04-14)

Reframe of the tail-return feature captured earlier the same day in `implicit-return-refinements-2026-04-14.md`. That note framed the tail `->` as sugar over `self as` (a projection). This note supersedes that framing: the tail-return is a **different mechanism** from `self as`, and should be thought of as "self becomes," not "self as."

Both mechanisms can coexist. See the "Relationship to `self as`" section below.

## The reframe

Old framing (morning of 04-14): a constructor tail expression declares an implicit `self as T` projection. The actor stays primary; the projection is a typed view you ask for by narrowing at the bind site.

New framing (afternoon of 04-14): a constructor tail expression declares that the wrapping actor **becomes** a thing whose interface structurally extends the returned-as type. The wrapping actor still has its own address and its own declared handlers, but its public interface is now `WrapperHandlers ∪ ReturnedType.interface`.

This is not just a renaming. Under "as," the actor is primary and projections are optional views. Under "becomes," the wrapper and the returned-as type are unified at the interface level — any code that accepts a `<p>` can accept a `Para` without narrowing, because `Para`'s public interface already includes `<p>`'s.

## The motivating example

```brevity
Para = <:content Text> {
  -> <p>{ content }</p>
}

para = Para(content: "hi")
document.body().attach!(para)
```

Constraint: `<p>` is a real DOM element, owned by the DOM subsystem. We cannot "fake" it — it has to be a genuine DOM address, and DOM has to accept real DOM element addresses in its own API (`attach!(e DOM.Element)`).

## Wire-level behavior

Instantiating `Para` produces a wrapper with its own address: `para/19`. The underlying `<p>` has its own DOM-owned address: `dom/elements/19`. These are two different addresses for two different actors.

When you call `document.body().attach!(para)`:

1. `attach!` is declared to accept a `DOM.Element` address.
2. The caller's type system knows that `Para` structurally extends `DOM.Element` (because `Para`'s tail return is a `<p>`, and `<p>` extends `DOM.Element`).
3. The caller resolves `para`'s address **at the call site**, rewriting `to: para/19` → `to: dom/elements/19` based on `attach!`'s parameter signature.
4. DOM receives a message addressed directly to its own `dom/elements/19` — no involvement from Para, no forwarding hop, no "which address is really mine" introspection.

The clever move: **the unwrap is driven by the receiving function's signature, not by runtime introspection on the wrapper.** The type system does real routing work. DOM stays ignorant that Para exists.

## Method dispatch: split routing, not forward proxy

Two candidate dispatch models:

- **(a) Forward proxy:** all messages go to `para/19`; Para forwards anything it doesn't handle to `dom/elements/19`.
- **(b) Split routing:** messages for Para's own declared handlers go to `para/19`; messages for methods inherited from `<p>` go directly to `dom/elements/19`, resolved at the caller's dispatch site.

**Choose (b).** It's consistent with the `attach!` case (which already does boundary-unwrap) and it means Para only ever sees messages for its *own* declared handlers. The "proxy" mental model is actually wrong — it's not a proxy, it's a fork in routing. Wrapper-declared methods and inherited methods go to different addresses, determined at the call site by the type system.

Consequence: Para is not a pass-through. It's a wrapper that adds its own interface alongside the wrapped one, and the caller's type system knows which half of the interface each call belongs to.

## Primitive case fits the same model

```brevity
C = <> { -> 42 }
c = C()
c + 1 == 43
c.method() == "info"   -- assuming @method is declared in C
```

Same mechanism, trivially applied to a scalar:

- `C`'s interface structurally extends `Integer`'s interface (which is effectively empty — Integer is not an actor with handlers, just a value type).
- `c + 1` works because `+` expects `Integer` inputs, and the caller resolves `c`'s address to the scalar `42` at the operator boundary — same as how `para` resolved to `dom/elements/19` at the `attach!` boundary.
- `c.method()` works because `@method` is declared in `C`'s own body and routes to `c`'s wrapper address directly.

If the model accommodates both the DOM actor case and the Integer scalar case without new mechanism, the design is on solid ground. Both are instances of "wrapper declares a structural extension; boundary unwrap resolves the correct underlying address/value at the call site."

## Relationship to `self as`

Under the new framing, `self as` and tail-return are **two different things** that coexist:

| | `self as T = -> expr` | `-> expr` (tail return) |
|---|---|---|
| What it declares | A typed projection / narrowing view | Structural interface extension |
| How many per actor | Many (multiple typed views allowed) | One (the "becomes" target) |
| Interface inheritance | No — projection only | Yes — wrapper's interface extends T's |
| Dispatch of T's methods on the wrapper | N/A (can only access T's surface by narrowing first) | Inherited, routed at call site |
| Use at call site | Requires narrowing: `n T = C()` | Automatic: wrapper usable wherever T is expected |
| Mental model | "C has a Text view" | "C becomes a thing that is also a T" |

The split is clean. `self as` stays exactly as it is (see `__tests__/keywords/self_as.md`). Tail-return is a new, distinct mechanism. A single actor can use both: multiple `self as` clauses for optional typed projections, plus one tail `->` for the structural extension.

## Naming

"Self as" is the wrong mental anchor for the tail-return mechanism. Two candidates:

- **"Self becomes"** — what Chris called it in conversation. Descriptive, but not obviously a keyword.
- **"Returns as"** — the tail `->` already reads as "return expression," and `returns` is already a Brevity keyword (declares return type). `Para returns as <p>` reads naturally and matches the semantic ("Para's instances return as, and therefore structurally extend, `<p>`"). Worth considering as the keyword anchor if this gets surfaced explicitly in any syntax beyond the tail `->`.

No decision yet. The tail `->` syntax itself doesn't need a new keyword — it's just an expression in the service block. The question is what to call the *mechanism* in docs and error messages.

## Open questions

1. **Handler name collisions.** If `Para` declares `@id` and `<p>` also has an `id` attribute-method, which wins? Almost certainly wrapper-first (Para's `@id` shadows the inherited one). Worth pinning down.
2. **Transitivity.** If `Para` extends `<p>` and `<p>` extends `DOM.Element`, does `Para` transitively extend `DOM.Element` for the purposes of boundary unwrap? Almost certainly yes — structural subtyping is transitive.
3. **The extension in the service interface.** For a caller to resolve `para/19` → `dom/elements/19` at a call site, the caller needs to know Para extends `<p>`. That means the extension relation must be part of `Para`'s **public service interface**, not just an implementation detail. The interface doc for Para should declare `Para extends <p>` (or however it's spelled) so consumers can type-check against it.
4. **Becoming a different instance of its own type.** `C = <> { -> OtherC() }` still makes sense under this model — `C` wraps another `C` instance, inherits its interface (trivially, since it's the same type), and calls to `C`'s handlers on the wrapper go either to the wrapper or to the inner instance depending on whether the wrapper overrides them. Useful for factory/substitution patterns.
5. **Cross-process identity.** When `para` flows through a message to another actor, the wrapper address `para/19` crosses the wire. The receiving side sees a `Para` address — no special unboxing. The structural extension only matters at type-checked call boundaries on the receiving side, where the receiver's own type system resolves the unwrap when needed. This is consistent and worth stating explicitly.

## Status

Design conversation 2026-04-14, afternoon. No implementation work yet. The reframe is settled enough to write down but not yet load-bearing in any code.

**The TDD spec file `__tests__/constructors/implicit_as.test.js` was written earlier today under the old "implicit self-as" framing** and uses `self as` language throughout. Those tests need to be revisited under the "becomes" model before implementation — several of them may be testing the wrong thing (e.g., the "coexistence with explicit self as clauses" test is still valid, but the runtime cases that narrow with `t Text = C()` should probably test the no-narrowing path as well, since that's the whole point of "becomes").

Do not start implementing without another pass on the test file and confirmation that the "becomes" framing has settled.
