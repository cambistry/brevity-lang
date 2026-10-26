# Reference fields in types — actor & function references as value fields (2026-10-26)

Design conversation. Generalizes the [Event-as-value-type](event-as-value-type-2026-10-25.md)
decision into a single mechanism: a **Type field may hold a reference** — an
actor address or a function/endpoint address — not only pass-by-value data.

Status: **proposed, not implemented.** First use case: calling `stopPropagation`
/ `preventDefault` on a passed browser `Event`.

---

## The tension

A Type is a homeless, portable, **pass-by-value** Object
([type/class split](type-class-split-2026-04-25.md)). An actor is
**pass-by-reference** — it lives at an address and you talk to it by message. A
function compiles to a label/address too. So "a value field that holds an actor
or a function" looks like it crosses the value/reference line the whole type
system is built on.

It doesn't. The line is about **what the field *is*** (data vs. behavior), and
the resolution is that a reference *is* data — specifically, it is an
**address**, and an address is already a string that travels inside an Object
with zero wire-format change. The value stays pass-by-value; one of
its fields just happens to be an address you can send to.

## What already exists (verified — do not reinvent)

The pieces are almost all in place. Investigation found:

1. **A reference is already a string-shaped value.**
   - CAM addresses are strings: `#<alias selector>`
     (`index.js:137` `parseTo`; [delimiter plan](address-delimiter-change-plan-2026-04-23.md)).
   - A `*Function` cell stores a string label `_lambda_N`
     (`marshal/capture.test.js:105-111`).
   - A DOM listener is stored as an address field value *today*:
     `onclick: '#<main @N>'` (`runtime.js:1757`). An `::Event.prevent` holding an
     address is literally the same shape pointed the other way
     (established in the [Event note](event-as-value-type-2026-10-25.md)).

2. **Type fields already serialize and tag themselves.** All-required →
   positional `[1,2]`; optional-bearing → named map; each slot carries a `bv-a`
   type tag (`::Point`, `Integer`, …) so the receiver can reconstruct
   (`types/type_wire.test.js`). A string-valued field needs no new encoding, and
   the `bv-a` channel is exactly the hook we need to mark a slot as an *address*
   (see CAM expression below).

3. **Invoking a reference held in a binding already compiles.** When a callee is
   `Function`-typed (`calleeType === 'Function'` or `calleeType.includes('->')`)
   the call lowers to `BvObject.pack(await this.#selfSend([[args], label]))`
   (`expressions.js:782-793`). A string callee at runtime self-sends; a closure
   is called directly (`expressions.js:822`). Fire-and-forget statement sends use
   `this.#send(op, to)` with **no `await`** (`expressions.js:769`).

4. **Field read is local** — no CAM round-trip (`types/type_field_access.test.js`).
   Reading `e.prevent` just pulls the string out of the value. Only *invoking* the
   read value sends. This is load-bearing for the Event case (reads must not
   `await`, or they leave the native dispatch frame).

5. **The field-type grammar already parses most reference forms.**
   `parseParenType` accepts a function signature `(x: Integer) -> (Integer)`
   (`parser.js:369-388`, `functionTypeToString:510`); `parseObjectType` accepts a
   bare identifier field type, i.e. a class / interface name (`parser.js:406-409`).
   So `onDone: (status: Integer) -> ()` and `handler: Logger` already *parse* as
   field types. **Caveat (the silent endpoint):** `parseFunctionType`
   (`parser.js:479-506`) hard-expects a parenthesized output list — `-> ( … )` —
   so `() -> ()` (void) parses but `() -> .` (silent, the endpoint form) does
   **not**. Accepting `.` as the silent output marker on a function type is a
   small grammar addition — see Adds.

**Conclusion: the wire format, the serializer, the invoke lowering, and the
field grammar all already exist.** What is missing is *semantics* — teaching the
compiler that a field whose type is behavioral is an address, and routing a call
made through a field read.

## The core idea: reference-ness falls out of the field's type

A field's type already tells you whether it is data or a reference — no new
sigil required:

| Field type | Kind | Field holds |
|---|---|---|
| Scalar (`Integer`, `Text`) or Type (`::Point`) | **value** | inlined data |
| Function signature (`(…) -> (…)`) | **reference** | address of a callable |
| Class / interface name (`Logger`) | **reference** | address of an actor |

Behavior cannot be pass-by-value in Brevity — only Classes-as-actors have
behavior and they are *always* addressed. So a field typed with a behavioral
type is *necessarily* a reference. The type is the whole signal.

Any capability sigil (`&` read-only / `*` write-invoke, per
[capability sigils](capability-sigils-2026-05-16.md)) layered on such a field is
**orthogonal** — it constrains *what you may do* with the address, not *whether
the field is one*. v1 does not need it; a reference field is invocable by
default.

## Three call disciplines, one mechanism

The mechanism is uniform (a field holds an address; invoking sends to it). The
field's declared type selects one of three **call disciplines**:

1. **Function reference** — `f: (x: Integer) -> (Integer)`. Single op,
   reply-awaiting. `v.f(3)` → `await selfSend([[3], addr])`. Reuses
   `expressions.js:787` verbatim.

2. **Actor reference** — `h: Logger` (a class/interface name). Multi-op; each
   method routes `@method` to the address. `v.h.warn("x")` → the exact path
   `remoteInstanceVars` already drives for dep-constructed instances
   (`classes.js:386-404`), except the address now arrives *inside a value*
   rather than from a local `new`.

3. **Endpoint reference** — `prevent: () -> .` **silent**. Single op,
   fire-and-forget, **no reply at all**. `v.prevent()` → `this.#send(sel, addr)`
   with **no `await`**. This is the discipline the Event case needs so the send
   posts synchronously inside the native dispatch frame.

The `.` is load-bearing and distinct from `()`. The
[void-return](void-return-2026-05-07.md) note draws a sharp line:

- **silent `-> .`** → *no `re` field at all*; the message is never replied to.
  This is genuine fire-and-forget — there is nothing to await, which is exactly
  what licenses the non-awaited `#send`. **This is what an endpoint field is.**
- **void `-> ()`** → `re: []`, an empty positional array. Still a reply, just
  empty — a caller would normally await it for confirmation. *Not*
  fire-and-forget.

So `prevent`/`stop` are `() -> .`, not `() -> ()`. The Event note's entire
remaining obligation — "emit prevent/stop as a non-awaited send; the self ack
defers and is ignored" — is just *silent discipline* applied to a field: no
reply means no await, nothing Event-specific.

## Surface syntax

```brevity
::Event = (
  type:    Text              // value field — inlined
  key:     Text              // value field — inlined
  prevent: () -> .           // endpoint ref — silent, fire-and-forget
  stop:    () -> .           // endpoint ref — silent, fire-and-forget
)

::Request = (
  url:    Text
  onDone: (status: Integer) -> ()   // function ref — reply-awaiting callback
)

::Session = (
  id:     Text
  logger: Logger             // actor ref — whole interface, routed per method
)
```

Call site (carried over from the Event note; `!` vs `()` still a surface call):

```brevity
<input onkeydown=(e) -> { if e.key == "Enter" e.prevent! }>
```

`e.prevent!` reads the `prevent` field (local, no await) and sends to the
address it holds (silent, no await — no reply to wait for). `e.key` is a plain
local read.

## CAM expression

Three things travel: the value, the invocation message, and the address
*inside* the value across hops. The third sounds like the hard part and turns
out to be already solved — see below.

### The value on the wire

`::Event` constructed by the listener wrapper, handed to the handler as `e`:

```json
{
  "re": { "type": "keydown", "key": "Enter",
          "prevent": "#<main _evt_prevent_7>",
          "stop":    "#<main _evt_stop_7>" },
  "bv-a": { "e": "::Event" }
}
```

The reference fields are ordinary string slots. Note the addresses are shown
*post-translation* (alias `main` prepended); as minted they are local-form
`#<@7>` / `#<@8>` — see translation below.

### The invocation message

`e.prevent!` lowers exactly like the existing DOM-closure route
(`runtime.js:1757`), fire-and-forget:

```json
{ "op": "_evt_prevent_7", "to": "#<main _evt_prevent_7>", "from": "<handler>" }
```

No awaited `re`. The ephemeral endpoint's handler calls native
`ev.preventDefault()` synchronously in its executor; the `self` ack defers and
is ignored. A reply-awaiting function ref (`onDone(200)`) is the same message
*with* an `id` and an awaited `re`.

### Addresses inside payloads are already translated payload-wide

My first pass assumed the hop machinery rewrites only `to`/`from`. That is
wrong. **Address translation is general and payload-wide today.** At the parent
routing seam, `rewriteLocalAddresses` (`browser/brevity.js:422`) runs a flat
regex over the *entire serialized message*:

```js
json.replace(/#<([@#][^>]*)>/g, (_, content) => `#<${selfAddr} ${content}>`)
```

It is deliberately a raw-text scan, not a `to`/`from` walk, *because* `#<` can
only occur inside a JSON string value — so **every** local-form address, in any
field at any depth (a reference slot inside a value included), gets the parent's
`selfAddr` prepended in one pass. This is the documented rule
([address translation](address-delimiter-change-plan-2026-04-23.md); memory
`project_address_translation`): *payload `#<@N>` / `#<#N>` → `#<selfAddr @N>`.*
An embedded reference is translated identically to `from`, with no per-slot tag
and no object-tree walk.

The discriminator is the leading char inside the angles: **local** (`@` / `#`)
→ prepend; **global** (word-char) → leave alone. Locally-minted
endpoints/closures are already emitted in local form (`'@' + counter`,
`brevity.js:100`), so they ride this path for free. The earlier "v2 needs a
`bv-a` address tag" idea is therefore unnecessary — the field's *static* type
(`logger: Logger`) already tells the receiver the slot is an invocable address,
and translation needs no tag at all.

So **reference fields in types travel and stay routable across hops with no new
mechanism.** What is actually conditional:

- **The seam must be wired.** Translation is opt-in per seam via
  `compileOptions.selfAddr` (`brevity.js:434`), and is implemented in the
  browser runtime today. The JS test harness (`index.js runActors`) routes flat
  without it. New seams (Rust/Erlang cross-process) mirror the same regex — the
  memory note's "how to apply" spells this out. This is integration, not a
  missing primitive.
- **References must be emitted in local form** (leading `@`/`#`) to be caught by
  the discriminator — which is already how closures/endpoints are minted.

### The Event caveat is timing, not addressing

Forward an `::Event` to a child/remote and `prevent`/`stop` still *route back
correctly* (translation handles it) — but they no-op, because by the time the
message arrives the native dispatch frame is gone. That is a **timing** contract
(the same one the platform enforces: you cannot `preventDefault` from a later
tick), not an addressing limitation. State it in the type's docs: the Type is
portable and its reference addresses stay routable; the *effectiveness* of the
two endpoint fields is in-frame. This is the Event note's "asymmetric
portability" clause, now correctly attributed to timing rather than to a
translation gap.

## Compiler routing — the one real gap

Everything above reuses existing lowering except the dispatch of a call whose
**callee is a field read**. Today the Function-typed self-send path keys on the
callee being an *identifier* in `currentTypeEnv` (`expressions.js:782`). A
field-read callee (`e.prevent`, `req.onDone`, `session.logger.warn`) is a
`DotCall`/member and misses that branch.

The gap closes by carrying the field's declared type through field access: when
`DotCall`'s object is a typed value and the named field's type is behavioral,
route by its call discipline —

- function sig with a reply (valued or void `-> ()`) → `await selfSend([[args],
  fieldRead])` (reuse `:787`);
- silent function sig (`-> .`) → `this.#send(sel, fieldRead)`, **no await**
  (reuse `:769`) — the endpoint case;
- class/interface name → the `remoteInstanceVars` per-method `@method` route
  (reuse `classes.js:386-404`), with the address sourced from the field read.

The type-checker already knows each field's type (it validates field access at
`type_field_access.test.js`), so the discipline is selectable statically.

## The Event ordering check (carried over, now general)

The Event note's lexical ordering rule — *every silent endpoint call must
precede the handler's first reply-consuming (`await`) send* — is unchanged and
now reads as a general property of **silent endpoint fields invoked inside a
handler that also awaits**. Same rule, same soundness argument, same open prerequisite
(source spans for a line-accurate diagnostic; `lexer.js` emits `{type,value}`
only). Coarse first (key the error to the handler + op), add offsets later.

## What reuses vs. adds

- **Reuses:** address-as-string wire form; Object field serialization +
  `bv-a` tags; Function-typed self-send lowering; silent fire-and-forget `#send`;
  `remoteInstanceVars` per-method routing; local field-read; the field-type
  grammar for valued/void function sigs + class names; **payload-wide address
  translation — references in value fields are already perspective-translated
  hop-by-hop** (`rewriteLocalAddresses`, `brevity.js:422`).
- **Adds:** (1) field-read call dispatch by discipline — the one real gap;
  (2) silent-endpoint non-awaited emission for a field call (shared with the Event
  note); (3) a grammar addition so `parseFunctionType` accepts `-> .` (silent
  output) — today it hard-expects `-> ( … )`, so the endpoint spelling `() -> .`
  does not yet parse as a field type; (4) the ordering check + (prereq) source
  spans. Portability across non-browser targets needs the existing translation
  regex mirrored at those seams (already specified), not a new mechanism.

## Open questions

- **Call-site glyph.** `e.prevent!` vs `e.prevent()` vs a capability-sigil form
  ([capability sigils v2](capability-sigils-2026-05-16.md)). The Event note left
  `!`/`()` as a surface detail; unify here rather than per-feature.
- **Endpoint field-type spelling — settled: `() -> .` (silent).** An endpoint
  is fire-and-forget, i.e. *no reply*, which is silent (`.`), not void (`()` →
  `re: []`). Reuses the existing void-return output side; the only cost is
  teaching `parseFunctionType` to accept `.` on the output side (see Adds). A
  named `Endpoint` type is unnecessary.
- **Capability sigils on reference fields.** Is a bare `logger: Logger` field
  invocable, or must it be `&Logger` / `*Logger` to send? Lean: invocable by
  default in v1; fold sigils in when capability-sigils v2 lands.
- **Non-local reference minting.** Translation catches only *local-form* (`@`/`#`)
  addresses. A reference whose address is already global/absolute when stored in a
  field is left alone (correct) — confirm nothing mints a cross-hop reference in a
  form the discriminator skips.
- **Local helper hiding an `await`** before a silent endpoint call — punted in the
  Event note; still punted.
