# `!` ⇒ mutates and returns self (language-level convention)

Status: **design, approved in principle 2026-10-27 — proposed for implementation.**
Builds on [bang-name-suffix-enforcement](bang-name-suffix-enforcement-2026-10-27.md)
(the call-site name-match, now implemented) and firms up the long-soft
convention from [big-factory-example §3](big-factory-example-2026-04-21.md)
("`append!` = mutate and return self", *"possibly enforced later"*) and
[capability-sigils L88/L147](capability-sigils-2026-05-06.md) (`!` as a mutating
name suffix; "free or repurposed?" left open). Decision: **enforce it.**

## The rule

A trailing `!` is part of a **function** member's name and means the function
**mutates and returns `self`** (the receiver). Consequences:

- You never write a trailing `self` to make a function chainable — `!` does it
  in one character: `document.body().append!(el)` chains because `append!`
  yields the body.
- `!` may appear only on a **function** member (a class function, or a
  function-typed reference field) — never a value field. (Already true: the
  parser rejects bang on value-field names; and `.foo!` / `.foo` are distinct
  members, enforced at the call site.)
- Enforced like the existing `assertBangValidRef` rule (parser.js) — "a bang
  method must return its receiver" — but extended from builtins to
  user-declared class functions and function-typed fields.

## No `-> .` silent discipline — a bang function takes *no* return declaration

Refinement (2026-10-27): a bang function should **not declare a return at all**,
not even the silent `-> .`. Reasoning (holds up):

- A "silent" (no-useful-return) function is, by definition, **mutational** —
  otherwise it does nothing observable. So *silent* and *mutational/bang* are the
  same category described twice. Collapse them.
- Whether to **await** is a **caller** concern, not a declaration property.
  Today the signature (`-> .` vs `-> (y)`) decides whether a reply exists, which
  conflates *what the function produces* with *whether the caller waits*. A
  mutation always produces an ACK (self); blocking on it is the caller's choice.

So the three-way discipline (value / silent / callback) collapses to **two**:

- **Non-bang = query** — declares a return; yields a datum; you await it because
  you want the value.
- **Bang = mutation** — declares *no* return; yields `self` (the ACK); the caller
  decides whether to await.

The `-> .` output marker is **removed**; discipline is re-anchored on the bang.

**This obsoletes "silent" functions as a syntactic category.** We lose the
`-> .` spelling entirely — return behavior is described by the bang in the
function *name*, not by a declared output. ("Silent" at the caller, i.e.
not awaiting the ACK, survives as the fire-and-forget call form below.)

## Await vs. fire-and-forget — OUTSTANDING DESIGN DECISION

**Default is await** (synchronous-like) — people expect a call to behave as if it
completes before the next line. Fire-and-forget is therefore **opt-in**, marked
by a trailing glyph at the end of the chain. Candidates under consideration:

- `div.append!(el) .`  — trailing dot (spaced). Resonant: `.` already connotes
  "silent / no-reply" (the silent handler terminator) — but that overlap is also
  the ambiguity risk against the statement/handler-level `.`.
- `div.append!(el).`   — trailing dot (attached). Same resonance; "a little too
  quiet" (easy to miss).
- `div.append!(el)...`  — trailing ellipsis. Reads as "trailing off, don't wait";
  visually unmistakable; no collision with the silent terminator. Leading
  candidate.

(Rejected: *implicit* fire-and-forget inferred from whether the result is used —
it breaks the synchronous-like expectation.)

**UNDECIDED** — glyph choice (and whether a separate explicit-*await*-without-
using-the-result form is also needed for ordering/causality cases). Resolve
before implementing the await/fire codegen.

## Open question — a service declaring it will NEVER ACK

Separate from the caller's await-vs-fire choice: a **service** may want to
declare, at the function's *declaration*, that it will **never** send an ACK —
not "the caller may skip it," but "there is no ACK to wait for, ever." Motivations:
drop the ACK-message overhead on a hot path; or a semantically fire-only sink
(telemetry/log) where an ACK is meaningless.

This is subtle: it's effectively an *explicit* "silent" marker returning through
the front door we just removed — but now a deliberate, declared capability
rather than the default for every no-return function. Key interaction: a
never-ACK function **cannot be awaited** — under the default-await model a caller
awaiting it would block forever — so the declaration must be visible in the
signature and the compiler must force such calls into the fire-and-forget form
(the glyph), or reject an await on them.

**UNDECIDED** — whether to add an explicit never-ACK declaration, its spelling,
and how it constrains the call site. Interacts with the fire-and-forget glyph
(a never-ACK call may be *required* to carry it).

## Two classes of "post-mutation information"

The rule returns `self`; the information you actually wanted comes from a
*chained* read. There are two kinds, and they need different machinery:

1. **Post-state query** — derivable from the receiver's *new state*.
   `my_div.append!(el).last` — `.last` reads the (now-last) child. A plain
   chained accessor; **CAM offloads it to the answering service** so the
   mutation and the query are **one round trip**, not a read-back. This is the
   common case and the first implementation target.

2. **Call byproduct** — produced by the *act itself*, not recoverable from
   post-state: `class_list.toggle!("k")` (which-way-did-it-go),
   `list.pop!()` (the removed element). A post-state query either needs the
   argument re-passed redundantly (`contains("k")`) or is impossible (the
   popped element is gone). This class needs a **byproduct channel**.

DOM audit (browser/runtime.js): of ~35 bang functions, **all return `(self)`
except two** — `class_list.toggle!: (Text) -> (Boolean)` and
`class_list.replace!: (Text, Text) -> (Boolean)`. Both are class-2 byproducts.
No DOM op *needs* a non-self return otherwise: create-and-insert nodes are
post-queryable (`.last`, `.rows.last`); remove/replace take the node as an
argument, so the caller already holds it. The genuine class-2 cases live in
**collections** (`pop!`/`shift!`/`dequeue!`), not DOM.

## Byproduct channel — three tiers (increasing power/cost)

1. **Clobber (now).** `toggle!` / `replace!` return `self`; the Boolean is
   dropped. Re-query `contains("k")` if needed, accepting the redundancy.
   Unblocks the rule; the two exceptions stop violating it.
2. **Service-object wrapper (explicit, general).**
   `toggle_service.toggle!(class_list, "k").result` — a service performs the
   mutation *and captures the byproduct as its own `.result`*. Fits `!`⇒self
   (the service's `toggle!` returns the service), CAM-offloadable (service
   answers `.result` from the same message), keeps byproduct-state off the
   receiver. Stateful/last-write — safe because CAM actors are sequential, so a
   `…toggle!(…).result` chain is atomic; a footgun only as a reused handle read
   later. This is the recommended home for `pop!`-class ops.
3. **Call-aware byproduct accessor (magic, ergonomic).** `!` returns self, but
   an *immediately chained* accessor is understood as "the byproduct of this
   `!`," resolved by the service that did the mutation, and **discarded when not
   chained** (mirroring "no `.last` ⇒ returns self"). The endgame; needs a real
   convention for "byproduct of the last `!`." Deferred.

## Proposed implementation (core rule, tier-1 byproduct)

Scope: enforce `!`⇒returns-self for user class functions and function-typed
fields; clobber the two DOM Booleans. (Service-object wrapper is a usage
pattern, no new mechanism; the call-aware accessor and the class-1 chained-query
*offload* are separate follow-ups — see Deferred.)

1. **Parser.** Accept a trailing `!` on a class function name (`@poke!`,
   parsePublicFunction ~3451) and on a **function-typed** field name
   (`ping!: () -> .`); reject it on a value field name ("only a function member
   may carry '!'"). (Value-field bang is already rejected incidentally; make the
   message intentional.)
2. **Validation.** A `!` function/field takes **no return declaration** and
   yields `self` (reject an explicit return on a bang member). Remove the `-> .`
   silent form; re-anchor reference-field discipline on the bang (mutating
   endpoint = bang field; query = non-bang field with a declared return). Relax
   the type-field call-site guard added in
   [bang-name-suffix-enforcement](bang-name-suffix-enforcement-2026-10-27.md)
   from "any bang → error" to "bang must match the declared (bang) name." The
   call-site bidirectional name-match already works for class/service functions.
3. **Codegen (js/rust/erlang).** Fix the body-lowering bug (a bang-named
   function's body currently mis-lowers a plain param as a function reference —
   observed on js). Ensure a bang-named function/field generates valid target
   identifiers (the `@poke!` dispatch key works as a string; derived
   identifiers — rust fn names, erlang atoms, js private names — must sanitize
   the `!`). Ensure a `!` function returns `self` when the body doesn't name a
   return.
4. **DOM manifest.** Change `class_list.toggle!` and `class_list.replace!` to
   `-> (self)`; drop/relocate the Boolean (re-query `contains` for now).
5. **Tests.** Bang-named class function declared + called (returns self,
   chains); bang-named function-typed field; value-field bang rejected at
   declaration; the existing call-site name-match tests still green;
   DOM toggle!/replace! return self.

### Re-churn this entails

Removing `-> .` and re-anchoring on the bang means mutating reference
fields/callbacks become **bang-named**: `::Signal = (dismiss!: (...), code)`,
invoked `s.dismiss!()`. This *reverses* the recent `.dismiss!` → `.dismiss()`
migration ([bang-name-suffix-enforcement](bang-name-suffix-enforcement-2026-10-27.md))
— but now the bang is *meaningful*, not spurious, and that note's call-site
name-match rule still holds (declarations simply gain bangs). The silent-call
**ordering** check (reference-fields note) re-anchors onto fire-and-forget calls.

### Blocked on the outstanding decision

The **await/fire codegen** (and the silent-ordering re-anchor) can't be built
until the **fire-and-forget glyph** is chosen (see the OUTSTANDING section).
Steps 1–5 above cover the `!`⇒self rule, declaration, and the clobber; the
await-vs-fire surface waits on that decision.

## Deferred (separate follow-ups)
- **Fire-and-forget glyph** — OUTSTANDING (see above); gates the await/fire work.
- **Class-1 chained-query offload** — making `append!(el).last` send the
  post-mutation `.last` *with* the mutation (one CAM round trip) rather than a
  read-back. The ergonomic payoff of the rule; its own mechanism.
- **Call-aware byproduct accessor** (tier 3).
- **Collection `pop!`/`shift!`** — decide: service-object wrapper (tier 2) vs.
  not-bang (returns a datum). Outside DOM; not blocking.
