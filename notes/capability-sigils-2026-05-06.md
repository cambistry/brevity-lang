# Capability sigils — `&` and `*` (v1) → interfaces (v2)

Date: 2026-05-06

Status: **v1 decided**, not yet implemented. **V2 direction noted** — interfaces as first-class assignable values, with sigils retained as coarse shorthand.

## The problem

How to express, in a param signature, whether the callee:

- gets a value (immutable snapshot)
- gets a live reference but can only read/subscribe
- gets a live reference and can mutate

Three concepts, currently squished into two: bare `Type` (value) and `Type!` (cell, full-cap, per the type/class split 2026-04-25). The middle case — read-only live reference — has no spelling.

Concretely, this came up writing a peer class:

```
Peer = <:name Text, :P List of Self> {
  peers List = []
  P.subscribe |p List| { peers <- p }
  @names = { over(peers) |p| { p.name() } }
}
```

If `P` is a value, `P.subscribe` makes no sense. If `P` is `List!` (full-cap), the callee implicitly gets write power it doesn't need. There's no way to say "live ref, subscribe-only."

## Dead ends

### Body-inferred capability

Let `!` on the param mean "live ref, capability is body-checked." If the body doesn't `<-` the param, no write grant is needed at the call site.

Rejected: signature should *declare* the contract. Inferring from body means refactoring an internal write into a method silently changes the call site's required grant. Capability is a boundary concern; boundaries should be explicit.

### Bare `List` covers value AND read-only ref

The thinking: callee can't tell, because both support read/subscribe and neither supports write.

Rejected: callee absolutely *can* tell, and the access pattern differs. By-value data is local — `peers[0]` is a direct read. By-ref data is remote — every read is a message round-trip, and `subscribe` is meaningful on a live source but nonsense on a frozen value. The shape of the receiving code differs.

### Postfix `&` / postfix `*`

`List&` reads ugly. Postfix `*` (`List*`) would work and `*` had been freed by the type/class split — but it leaves cell declarations stuck on `List!`, and `*` carries no cross-language convention for "read-only ref" (in C/C++/Go it's any-access).

## V1 decision: prefix `&` and `*` on scalar types

```
list *List = []                 // host: full-cap cell

<peers: List>                   // client: by val
<peers: &List>                  // client: by ref, read-only
<peers: *List>                  // client: by ref, read/write
```

Call site:

```
App(peers: list)                // by val or by-ref-read-only per sig (auto-coerce)
App(peers: *list)               // explicit write grant. prefix position mirrors sig.
```

### Why prefix

Earlier worry about prefix conflicting with negation evaporates because `&` and `*` aren't the negation char; only prefix-`!` would have collided. Prefix puts the capability mark in front of the type, where a reader is already looking.

### Why the asymmetric grant

Read-only is "less than" the caller's capability, so it auto-coerces — the caller doesn't need a sigil. Write is "the caller's full capability," so an explicit grant is required. The asymmetry matches Pony / Rust borrow conventions: you opt in to handing out write power.

### Cell declaration form

```
list *List = []     // full-cap cell — replaces current `list List! = []`
list &List = []     // probably drop. obscure.
list List = []      // value
```

Read-only-cell-from-the-inside is conceptually muddled — the cell's owner always has full caps over its own slot. Read-only-ness is meaningful only at a *boundary*, so `&` should be a param-side-only sigil.

## The cascade — what happens to `!`

This deprecates postfix `!` from the type/class split (2026-04-25). The cell-as-cell role moves to prefix `*`. The bang is freed.

Open: does `!` get repurposed, or stay available? `Self!` and `name: Text!` no longer have meaning under v1. The wire-protocol notes (`tail-return-wire-2026-04-15.md`) and the type/class split note will need amendments. Worth a sweep before committing.

`!` may still survive as a method-name suffix convention for mutating methods (`peers.append!(x)`) — that's an orthogonal use that doesn't conflict with the type-position deprecation.

## V2 direction: interfaces as first-class

Brevity already has structural interface syntax in type position:

```
<peers: { append!: (Type) -> self }>
```

This is more precise than `*List` — it specifies *which* methods, not "the full API." V2 promotes interfaces to first-class assignable values:

```
PEER_CONTRACT = { append!: (Type) -> self }
<peers: PEER_CONTRACT>
```

Implementation cost is small. The parser already accepts `{ ... }` in type position; v2 just lifts the position restriction onto the RHS of `=`.

### Sigils as coarse shorthand under v2

V1 sigils survive in v2 as documented expansions:

- `&List` ≡ "the interface comprising all read methods of List"
- `*List` ≡ "the interface comprising all methods of List"

Refining `*List` → `{ specific methods }` becomes a per-call-site precision upgrade, never a breaking migration. V1 code remains valid in v2.

### Interfaces as a third kind

|           | identity? | implementation? | portable? |
|-----------|-----------|-----------------|-----------|
| Class     | yes       | yes             | no        |
| Type      | no        | no              | yes       |
| Interface | no        | no              | yes       |

Type is shape of *data*; Interface is shape of *behavior*. A publisher class exposes its surface *as* an interface; subscribers reference the interface to know how to talk to instances. Cross-process portability is what separates Interface from Class — the constraint travels, the implementation stays home.

## V2 thinking parked for later

### Capability grant as proxy

Two implementation paths for granted handles:

1. **Static narrowing via param sig** (cheap, common case). Underlying object passes through unchanged at runtime; type system binds the recipient to the interface.
2. **Dynamic narrowing via proxy** (expensive, principled case). Wrap the cell in an actor exposing only granted methods. Real overhead, but yields a first-class capability token: forwardable, persistable, potentially revocable.

For inline call-site grants, (1) is what's wanted, and is already implicit when the param is interface-typed. (2) earns its weight only when the granted handle has a life beyond a single call.

### Stringly-typed cap args

If a `grant(x, cap)` function is introduced, `cap` must be a String (no symbols — wire-portability rules them out across polyglot processes). Typo-safety can come from a constrained Text subtype like `::Cap = "r" | "w" | "*" | "sub"` if literal-union types land. Otherwise runtime-error on unknown caps is acceptable for a small vocabulary.

### Independent value of the call-site grant marker

Even when v2's type system can infer the write-grant requirement from interface methods, the explicit `*list` at the call site has standalone value as a *human-readable boundary annotation*: "I am consciously handing you mutation rights." Worth keeping in v2 even when redundant for the type checker.

## Open questions

- What does `!` mean post-type-position-deprecation? Free, or repurposed?
- Sweep of existing notes (`tail-return-wire-2026-04-15.md`, `type-class-split-2026-04-25.md`) to mark superseded sigil semantics.
- First-class capability tokens (forwardable, revocable) — needed in v2, or YAGNI?
- Does Brevity's type system support literal-union types? If yes, `::Cap = "r" | "w" | ...` works for cap-arg validation.
- How does Class-vs-Interface fuzz out in practice? A class is constructable, an interface is not — but day-to-day, "exposing my class via an interface" might want sugar.

---

## Addendum — the `*` snowball and unified `|` compose operator

Side observation that came out of the same conversation: `*` is converging on a single coherent role across the language — **the gateway to "actorize / make instantiable."** It composes uniformly with the surrounding syntax:

```
*Integer                            // actorized scalar
*(Integer | null)                   // actorized nullable
*(Integer | Custom)                 // actorized union type
*(Integer) { @fibonacci = {...} }   // actorized scalar with decorator/method
*(Super | add_attrs)                // actorized class extending Super
*(Super super | add_attrs)          // ...with super-instance bound as `super`
```

The pattern is `*<type-or-class-expression>`, optionally followed by `{ body }` for method/decorator definitions. Parens become the "compose this expression" delimiter when the inside is non-trivial.

### `|` as a unified compose operator

Came up in passing, worth recording: the `|` inside `*(...)` may not be two different operators (subclass vs type union). It may be **one compose operator** whose semantics derive from the *operand kinds*:

- `|` between bare types/classes → **value union** (instance satisfies either)
- `|` between a class and field declarations → **structural extension** (subclass with additional attrs)
- `|` between a class with `super`-alias and field declarations → **inheritance with super-binding**

Same syntax, contextual semantics. If this holds up, Brevity has one composition primitive — not separate "extends" / "implements" / "union" operators — and class definition becomes a special case of "compose these things into a class-shaped thing."

### The open question: `*(ClassA | ClassB)`

If the unified-compose model holds, this needs a definite answer:

- **Multiple inheritance?** (Compose both interfaces. Gnarly conflict-resolution territory.)
- **Value union?** (Instance satisfies ClassA OR ClassB. Probably the most consistent reading.)
- **Error?** (Class-class composition without field decls is meaningless — force the user to be explicit.)

Each is defensible; they're irreconcilable. Picking before code lands matters because it pins down what `|` actually means at the type level. Initial lean: value union, on grounds that bare classes-without-extension don't naturally express "merge these," whereas value union has a clear interpretation.

### Why this matters for the v1→v2 arc

The capability sigils story (`&`, `*`) and the class-composition story (`*` + `|` + parens) are the same design arc: **`*` is the universal "this thing has identity / runs / can be sent messages" marker.** Every place `*` appears, it's saying "actor-flavored, not value-flavored."

That coherence is worth protecting. Decisions about `*` in one context (e.g., write-cap ref) should be checked for consistency against `*` in other contexts (class definition, scalar wrapping). If `*` ever does something that *isn't* "actor-flavored," that's a sign the meaning is fragmenting.
