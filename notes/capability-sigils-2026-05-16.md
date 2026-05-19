# Capability sigils — call-site forms, write spelling, polymorphic params

Date: 2026-05-16

Status: **Exploratory / leaning, NOT decided.** Continuation of
`capability-sigils-2026-05-06.md` (v1: prefix `&` read, `*` write+actorize).
This note records a design conversation that pressured the call-site side of
that model. Several pieces are converged-on; the write glyph and the
polymorphic-param rule are leaning but explicitly unsettled.

## What kicked this off

Two adjacent moves, neither finalized:

1. **Auto-accessors for classes probably deprecated.** Accessors can be
   declared manually, or a class can wrap a value/shape via the return-as
   tail: `BoxBox = *(w,h,d) -> Box(width: w, height: h, depth: d)`. This
   doesn't *remove* the implicit-accessor magic, it *relocates* it to
   "field reads forward into the return-as value" — a better place for it
   because the wrapped shape is visible in source rather than synthesized
   from field declarations.

2. **Reactive value cells.** A type constructor auto-subscribes when a field
   is populated with a closure or an actor ref instead of a value:

   ```
   BoxBox = *(w Integer, h Integer, d Integer) {
     width  = *Integer(w)
     height = *Integer(h)
     depth  = *Integer(d)
     @grow { width <- width + 1; height <- height + 1; depth <- depth + 1 }
     -> *Box(&width, &height, &depth)   // or *Box({width}, {height}, {depth})
   }
   ```

   This is the same thunk-driven reactivity as the HTML model — one
   reactive primitive (the closure), not a new one per surface.

## Field / argument population: three forms

A `*`-constructed cell field, and (by the unification below) a call argument,
can be populated three visibly distinct ways:

- `width`     → a **value**: snapshot, dead.
- `&width`    → an **actor read-ref**: subscribe to that cell's re-stream.
- `{width}`   → a **closure/thunk**: subscribe to / re-evaluate the thunk.

`&x` is the degenerate case of `{}` — a thunk that is exactly one cell read.
`{}` is the general form; it also covers *derived* fields `&` can't express
(`{width + height}`). `&` and `{}` are **not** two spellings of one thing;
`{}` is a block/closure, it does not resolve to a value on its own. Keep them
distinct. Snapshot-vs-live stays legible at the call site (`x` vs `&x`/`{…}`).

### Open: coherence under multi-field update

`@grow` does three independent async `<-` sets; a subscriber to the
constructed Box can observe torn intermediate states (width bumped, height
not). This is the classic glitch/diamond, sharpened by derived thunks
(`{width + height}` subscribed to two cells). **Decision required, not an
impl detail:** accept tearing in v1 (cheap, honest about async) *or* make
`@grow` a coalescing boundary that emits one coherent re. It changes what
`subscribe Box` means.

Note: per-component cells (v3 above) vs. one `box = *Box(...)` cell that is
wholly replaced in `@grow` (v2) are **not refactors of each other** — v2 is
atomic/coarse, v3 is torn/fine-grained. Name the trade as
"granularity vs. atomicity," not "cleaner."

### Open: subscription lifetime

Auto-subscribe implies auto-unsubscribe, symmetric with the constructed
actor's lifetime, or re-streams leak. The closure arm additionally holds its
captured scope alive for the subscription's duration — one rule should cover
both arms (auto-release of capture on teardown).

## Call-site capability — the unifying rule

Prior decision (2026-05-06 era) eliminated a caller-side ref sigil on the
grounds "the callee signature decides val-vs-ref." The reactive-cell case
revives a caller-side need, but **does not contradict** the old rationale —
it sidesteps it:

> The parameter's declared type is the contract. A bare argument
> **self-as-resolves** to it, and self-as only ever **narrows** capability
> (`*X` → `&X` → `X`-value), never escalates. Narrowing is always safe and
> always **silent**. A caller-side marker is required *only* to request a
> resolution the declared type would not itself produce — i.e. the
> non-narrowing direction.

`&width` is not "caller overriding convention" — it constructs a *different
operand* (a ref) from the same name. Different operand, not different
calling convention; like `f(3)` vs `f(4)`, this is not a contract break.

Consequences worked through:

- `head = (list &List)` called `head(stuff)` with `stuff: *List` → forced
  narrowing, bare is correct; `&stuff` would be decorative.
- `fn = (c Cls)` with a class actor → a class is only-ever-a-reference,
  nothing to disambiguate, bare is correct.
- Self-as never *escalates*, so a bare arg can't accidentally grant write;
  write is handed over only if the callee signature openly says so.
- The one mandatory-marker case is the **escalating** one: feeding liveness
  / write into a param whose declared type wouldn't produce it. That is the
  only place the signature would otherwise *lie* about runtime behavior.
- Ceremony belongs on the consequential side. Snapshotting an actor severs
  liveness — that's the act worth being able to see — but a by-value marker
  must stay **available, not mandatory** (mandating it on the safe/narrowing
  side reintroduces decorative ceremony).

## `*` stays actorize-only — do NOT also make it deref

C/Rust read `*x` as deref-to-value. Tempting, since "cast actor to
underlying value" is a real operation. Rejected, over-determined:

1. Deref is **already expressed**: bare-arg self-as narrowing performs it
   implicitly at the only place it matters; deliberate snapshot is served by
   optional `as`. A `*x` deref operator is redundant with both.
2. `*`=actorize **already** fights C/Rust `*`=deref intuition (two of three
   targets are JS/Rust/Erlang). That redefinition is survivable only if it
   is **total**. Same glyph as both the C-meaning (deref) and its inverse
   (actorize), operand-dependent, is the worst case.
3. Actorize and deref are **inverses**; sharing a glyph between `f` and
   `f⁻¹` is worse than overloading unrelated meanings.

→ Keep `*` = actorize only; document it as a deliberate, total break from
C/Rust `*`=deref so it isn't "restored" later on familiarity grounds.

## Write-capability spelling — leaning `&+`, not settled

Explored, in order:

- **`&&` for write.** Rejected. (a) Collides with boolean-and *if* Brevity
  spells conjunction `&&` — reader, not just parser, must disambiguate
  prefix-cap from infix-bool on the most common binary operator. (b)
  `&` → `&&` is a one-keystroke escalation that **fails open**.
- **`&` as the actor-declaration sigil** (replacing `*`). Rejected. The
  "addressed" intuition lives at the *reference* site, not the
  *declaration* site (`&` = refer-to-existing; declaration = spawn-new,
  closer to `*`). Also forces a full permission re-founding and breaks the
  `*`-means-actor-everywhere unification.
- **`&+` for write (leaning).** Read `&` = read, `&+` = read/write.
  - No boolean-`&&` collision regardless of how conjunction is spelled.
  - Typo `&+` → `&` *downgrades* → mismatch **fails closed** (write-needing
    callee rejects loudly), the correct failure direction.
  - `+` reads as "the borrow, plus power" → matches the `write ⊒ read`
    lattice better than "more borrow."
  - Its mandatory-ness is **not a new rule**: self-as cannot manufacture
    write (escalation), so `&+` is forced exactly and only at write-param
    call sites — same narrowing rule, `&+` is just the glyph for the one
    resolution self-as won't perform.
  - Caveats: the `&`(1ch)/`&+`(2ch) asymmetry is an **intentional**
    robustness/operator-safety trade — record it so it isn't "tidied" back
    to `&&`. Heavier mark on the rarer, more dangerous capability is
    *aligned* with the design philosophy, not a wart. The "fails closed"
    safety is **contingent on "capability mismatch is a hard error"** — that
    rule and this glyph are now load-bearing together.

## Polymorphic params — lowest-common-capability

When a param accepts a **sum** (`value | &ref | {closure}`), bare-narrowing
has no single target. Rule:

> Bare resolves to the **unique least-capability arm** the param admits.

This *generalizes* the narrowing rule (monomorphic = singleton sum). The
lattice bottom is `value` (snapshot/dead = least power) `⊏` `&` (live read)
`⊏` `&+` (live write). So `value | &ref` → bare picks `value`; **fails
safe** (under-specification never grants liveness/write).

**Validity boundary** (the precise edge): well-defined *iff the admitted set
has a unique minimum*. A sum like `&ref | {closure}` with no value arm —
two "live read" siblings, plausibly unordered — has no common floor; there
**bare is an error** and an explicit marker is mandatory. Not a special
case: same principle as everywhere ("bare works exactly when resolution has
one answer").

### Residual: explicit "by value" clarity

Real worry: cases will want *full clarity* that an arg is by-value, even
when lowest-cap already determines it. Resolution: this is a **legibility**
need, not a **semantic** one (semantics already pinned). Answer = an
**optional, positive** `x as T` annotation, available at polymorphic call
sites so intent travels with the call, **never mandatory** (mandating it is
the rejected decorative-ceremony-on-the-safe-side failure). `as` may
*document* by-value; it must never be the thing that *makes* it by-value.

## Open questions

- Glitch/atomicity: tearing-accepted vs. `@grow`-coalesced. Unsettled.
- Subscription + capture teardown: one symmetric rule — needs spelling.
- Conjunction spelling (`&&` vs `and`): confirm against syntax docs; only
  affects whether the `&&` rejection rationale (a) was even live, but `&+`
  sidesteps it either way.
- `&+` vs other write glyphs: `&+` leads but is provisional; criteria are
  fixed (monotone with `&`, not one-keystroke-from it, no operator
  collision, fails-closed on typo).
- Whether the lattice has `{}` and `&` as ordered or sibling — determines
  how often the "no unique minimum → bare is error" case fires.

## Pointers

- Predecessor: `capability-sigils-2026-05-06.md` (v1 prefix `&`/`*`,
  v2 interfaces direction).
- Reactivity mechanics: `subscription-via-multi-re-2026-04-18.md`,
  `reactive-dom-lifecycle-2026-04-13.md`.
- Type/Class & self-as: `type-class-split-2026-04-25.md`,
  `refs-via-self-send-2026-04-09.md`.
- Return-as / tail: `tail-return-wire-2026-04-15.md`,
  `return-type-inference-2026-05-06.md`.
