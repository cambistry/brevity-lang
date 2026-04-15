# Tail-return on the wire: CAM protocol implications (2026-04-15)

Follow-up to `self-becomes-2026-04-14.md` and `callable-files-2026-04-14.md`. Those notes established the semantics of tail-return ("self becomes"). This note is about the wire-protocol side: what has to happen in CAM for tail-return to actually work when messages cross actor boundaries, and what needs to be decided before implementation or tests can be pinned down.

Status: **proposals**, not settled. The shapes below are plausible, grounded in the existing CAM protocol, and mutually consistent — but the design conversation hasn't agreed on any of them yet. The `__tests__/constructors/return_as.test.js` and `__tests__/constructors/file_return_as.test.js` test files that Chris wants to write are gated on settling at least items 1–3 below.

## What CAM currently has

Grounded in `__tests__/cam/remote_instance.test.js`, `__tests__/cam_test/get.test.js`, and `__tests__/cam/remote_instance.md`:

1. **`::new` is the construction op.** Wire shape:

    ```js
    // Outbound (caller → type):
    { op: [{ host: 'localhost', port: 5432 }, '::new'], to: 'Database' }

    // Inbound (type → caller):
    { id: '1', re: {}, 'bv-a': 'self<Database>', from: 'Database/1' }
    ```

    Construction params are the first element of the `[args, '::new']` tuple. Reply carries `bv-a: 'self<Type>'` (a type marker, not an object) and `from: <new-instance-address>`. After that, all method calls go `to: <instance-address>` with `op: '@method'`.

2. **There is no production CAM op for "get the whole actor object."** The only thing close is `test.get` (`__tests__/cam_test/get.test.js`), which is test-only and reads individual state vars by name:

    ```js
    { input: { test: { get: 'x' }, from: 't' } }
    // → { 'bv-a': 'Integer', re: 42 }
    ```

    In production, **CAM is strictly actor-addressing**: you message an actor, you don't fetch it. An actor is defined by the messages it accepts, not by a serializable object payload. The `self<Type>` marker in `bv-a` is a *typed address reference*, not a state snapshot.

3. **Instance references persist across calls.** Once a caller has a `from: 'Database/1'` address, it reuses that address for all subsequent method calls. The type system carries the instance address with the binding.

**Answer to the literal question that prompted this note** ("do we have a form for getting an entire actor object at all?"): **No.** CAM has never had one. We have only ever called handlers on actors. The protocol is intentionally address-centric, and the actor's state is encapsulated behind its handler surface. Tail-return does not change that principle — it adds a new kind of *address-level relationship* (wrapper → inner), not a new kind of object-level marshalling.

## The three shapes of tail-return

Tail-return is not a single wire pattern. Depending on what the tail expression evaluates to, there are three distinct shapes with different wire-level needs. All three need to be accommodated — the mechanism is the same at the language level, but the CAM protocol touches each differently.

### Shape 1: value-tail (DOM wrappers, primitive boxes)

The tail expression produces a *value captured at construction time*. Example:

```brevity
Para = <:content Text> { -> <p>{ content }</p> }
```

Para's instances come into existence with an inner `<p>` already created and stable. The wrapper and the inner DOM element are born together, and the inner's identity must be preserved across all future boundary-unwraps (`attach!(para)` has to reference *this particular* `<p>`, not a fresh one).

**Proposal: extend the `::new` reply with a `tail-as` field.**

```js
// Extended ::new reply for a value-tail wrapper:
{ id: '1', re: {}, 'bv-a': 'self<Para>', from: 'Para/19',
  'tail-as': { type: 'DOM.Element', ref: 'dom/elements/19' } }
```

- `tail-as.type` — the declared type of the tail projection.
- `tail-as.ref` — the resolution. For actor-shaped tails, an address (`'dom/elements/19'`). For primitive tails, the scalar itself (`'tail-as': { type: 'Integer', ref: 42 }`).

The caller caches this metadata alongside the wrapper's address at construction time. When it later passes `para` across a boundary expecting `DOM.Element`, the caller rewrites `to: 'Para/19'` → `to: 'dom/elements/19'` using the cached `tail-as.ref`. **Zero round-trips per boundary-unwrap.**

This is the cheapest and cleanest option for Shape 1. It front-loads the routing metadata into the one round-trip that already exists (construction), and every subsequent unwrap is local.

**Alternative (worse):** lazy discovery via a new `::as` op. Caller sends `::as 'DOM.Element'` to the wrapper on first use, wrapper replies with the inner address. One round-trip per unique (wrapper, target-type) pair, caching on the caller side. Only reach for this if `tail-as` resolution is genuinely expensive on the wrapper side — which for the DOM case it isn't.

### Shape 2: constructor-tail (Factory, file-as-constructor)

The tail expression is itself a *constructor*. Example (from `notes/callable-files-2026-04-14.md`):

```brevity
// factory.bv
<HTML: (:p) *> {
  <:content Text>
  ->
  <p>{ content }</p>
}
```

At Factory's own construction time, there is no "inner thing" to carry metadata for — the inner widget doesn't exist until the caller invokes `Factory(content: "Hello!")`. The `::new` reply for Factory itself should look like a normal instance reply (no `tail-as` resolution, because there's nothing to resolve yet):

```js
{ id: '1', re: {}, 'bv-a': 'self<Factory>', from: 'Factory/1',
  'tail-as': { type: '<:content Text> -> DOM.Element', kind: 'constructor' } }
```

The `kind: 'constructor'` flag tells the caller: "when you call this wrapper, treat it as a constructor invocation." The `type` field is the tail's declared signature.

**Wire shape for `Factory(content: "Hello!")`:**

I think the consistent answer is **`::new` again, this time targeted at the already-constructed Factory instance's address instead of at the Factory type**:

```js
// Caller sends:
{ op: [{ content: 'Hello!' }, '::new'], to: 'Factory/1' }

// Factory/1 routes internally to its tail constructor, replies with a new widget:
{ re: {}, 'bv-a': 'self<Widget>', from: 'Widget/7',
  'tail-as': { type: 'DOM.Element', ref: 'dom/elements/7' } }
```

`::new` keeps its meaning ("make me a new thing"), but the target is now dynamic — it can be a type *or* an instance with a tail-constructor. The routing decision happens at the target side based on what the target holds.

This is a small but real generalization of `::new`. Stated explicitly: **`::new → <target>` is valid when `<target>` is either a registered type, or an instance whose tail-return is a constructor.** The dispatch happens at the target.

**Why this is the right call:**

- Keeps `::new` as the single "make me a new thing" op. No new op to learn.
- The type system already knows the distinction (via the import declaration's signature), so callers route correctly without runtime introspection.
- Recursively consistent: the new `Widget/7` can itself have a `tail-as` that resolves further (e.g., to its own `<p>` address), and the caller caches that too.

### Shape 3: function-tail (function.bv)

The tail expression is a function literal. Example:

```brevity
// function.bv
<> { |params| { output } }
```

Functions are not constructors — they return *values*, not addresses. Nothing is being "constructed" when the caller invokes the function. `::new` is the wrong op; there's no new self-of-type to announce.

**Options for the wire shape of the invocation:**

- **(a) New op `::call`**, symmetric with `::new`.
    ```js
    { op: [{ x: 1, y: 2 }, '::call'], to: 'function.bv/1' }
    // Reply is a plain value-return:
    { re: { result: 3 }, 'bv-a': { result: 'Integer' } }
    ```
    Consistent with `::new` (both `::`-prefixed system ops). Keeps value-returning calls visibly different from actor-method calls on the wire.

- **(b) Special handler `@()`** — the anonymous-call handler.
    ```js
    { op: ['@()', { x: 1, y: 2 }], to: 'function.bv/1' }
    ```
    Reuses the existing method-call wire shape, but introduces a magic handler name that has no natural spelling in source code.

- **(c) Generated `@call` handler** — Brevity synthesizes `@call` on function-tailed actors. Callers send `@call` like any other handler. No new primitives on the wire, but the generated name is implementation-visible and collides trivially if the user ever declares their own `@call`.

**Lean toward (a) `::call`.** It stays in the `::`-prefixed system-op namespace alongside `::new`, keeps call semantics clearly distinct from message semantics, and avoids generating magic handler names. The two system ops — `::new` for "construct" and `::call` for "invoke function" — form a clean pair that covers the "talk to a thing you just imported" cases.

## The gating open question: import declaration syntax

The caller's type system has to learn about the tail projection *at import time*, because that's when it commits to the routing strategy. The existing import declaration syntax (`__tests__/cam/remote_instance.test.js`) spells out the constructor params and the handler interface:

```brevity
<"WebView": (WebView) <:path Text> -> { open: () -> . }>
```

For tail-return files, this needs to *also* spell the tail projection. Sketch:

```brevity
// File-as-constructor (Factory):
<"factory.bv": (Factory) <HTML: (:p) *> -> <:content Text> -> DOM.Element>

// File-as-function:
<"function.bv": (Fn) <> -> |params| -> Output>

// File with both handlers AND a tail:
<"para.bv": (Para) <:content Text> -> DOM.Element { @update = (:text Text) -> . }>
```

The second-stage arrow (`-> <:content Text> -> DOM.Element` or `-> |params| -> Output`) says "this file *becomes* …" and the shape of the rhs determines the wire strategy:

- `-> <params> -> Type` ⇒ constructor-tail ⇒ route `Factory(…)` as `::new` to the instance.
- `-> |params| -> Type` ⇒ function-tail ⇒ route `"function.bv"(…)` as `::call` to the instance.
- `-> Type` (no inner param list) ⇒ value-tail ⇒ the `tail-as` on the `::new` reply carries the resolution; no further invocation mechanic needed.

These are sketches, not proposals. The exact syntax needs deliberate design — particularly around how to combine a handler interface `{ @update = … }` with a tail projection in the same import signature. But the *shape* matters because the wire choices fall out of it: if the import says "this file becomes a constructor," the caller knows to route `Factory(…)` as `::new`; if it says "this file becomes a function," the caller uses `::call`; if it says "this file becomes a value of type T," the caller extracts `tail-as` from the construction reply.

## What this means for tests

The `__tests__/constructors/return_as.test.js` (in-script tail-return) and `__tests__/constructors/file_return_as.test.js` (file-level tail-return) tests Chris wants to write are gated on these wire decisions. Without settling at least items 1–3 in the next section, the tests would have to either:

- Guess at wire assertions (risking rewrites when the protocol is pinned down), or
- Assert only at the language level (ignoring the wire shape, which misses the point of the cam/ tests).

Recommend: **pin the wire shape first, then write tests that assert both the language-level behavior and the CAM-level emissions.** The existing `__tests__/cam/remote_instance.test.js` is the template — both the in-script and file-level tail-return tests should follow the same `createActor` + `expectActorBehavior` pattern, with the `::new` reply shape (now including `tail-as`) as one of the key assertions.

## What to settle before implementation or tests

1. **`::new` reply extension for value-tail.** Add `tail-as: { type, ref }` to the construction reply. The `ref` is an address for actor-shaped tails and a scalar for primitive tails. Caller caches this at construction time and uses it for boundary-unwrap routing with zero round-trips.

2. **`::new` targeting an instance with a constructor-tail.** Generalize `::new` so it can target either a registered type or an already-constructed instance whose tail-return is a constructor. The dispatch happens at the target. No new op, just a routing generalization.

3. **`::call` for function-tail.** New system op for invoking a function-tailed actor, returning a value rather than a `self<Type>` address. Alternative is a generated `@call` handler, but `::call` keeps the `::`-system-op namespace consistent.

4. **Import declaration syntax for tail-return files.** Needs to spell the tail projection so the caller's type system knows how to route. Sketches above are a starting point — the hard cases are value-tail with handlers, and nested tail-returns (tail that has its own tail).

5. **Caching semantics for `tail-as` metadata.** Is it bound to the instance address for its lifetime? Is it invalidated on any event? Probably "bound for the lifetime of the wrapper address," given that the tail value is captured at construction and identity is preserved — but worth stating explicitly.

## Why this is worth writing down now

Tail-return has felt increasingly settled at the language level (see `self-becomes-2026-04-14.md` and `callable-files-2026-04-14.md`), but the wire-level story has been hand-waved. Without a concrete proposal for how `::new` replies carry tail-as metadata, how `::new` generalizes to instance targets, and how function-tails are invoked, the whole design risks looking cleaner in the notes than it will be in the code. Writing this down now forces the three shapes (value, constructor, function) to be distinguished explicitly and gives each a concrete wire story — even if the stories change, at least they're on record to react to.

Secondary reason: the CAM-level tests that Chris wants next are gated on this. Writing them without settled wire shapes would either guess (and need rewrites) or ignore the wire entirely (defeating the point). This note is the prerequisite artifact.

## Status

Design conversation 2026-04-14 through 2026-04-15. No implementation, no tests, no wire changes yet. Proposals 1–5 above are for discussion, not commitment. Read this alongside `self-becomes-2026-04-14.md` (language-level mechanism) and `callable-files-2026-04-14.md` (file-level application) — those establish the semantics; this one adds the wire.
