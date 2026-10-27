# Browser event model: `Event` as a value type with endpoint fields (2026-10-25)

Design conversation. Settles how `preventDefault` / `stopPropagation` fit the
browser target, which the current event path does not address at all.

Status: **converged; delivery half implemented 2026-10-27.** The HTML actor now
builds and emits the `HTML::Event` value on a native DOM event (see "Delivery
landed" below). The *authoring* half — the inline `on*=(e) -> { … }` param
syntax that binds the event to a handler — is deliberately **not** built yet;
it is feature work (lexer/parser/closure synthesis) deferred to a later pass.
One toolchain prerequisite (source positions, for the ordering check) is still
open.

---

## Delivery landed (2026-10-27)

The runtime half is in. On element construction, an `on*` attribute whose value
is a handler address still wires a native listener (`runtime.js`), but the
listener now constructs an `HTML::Event` value per fire (`buildEventValue`) and
routes it to the handler address as a positional argument tagged
`#<HTML ::Event>`:

- **Generic value fields** (`kind`, `phase`, `bubbles`, `cancelable`,
  `composed`, `default_prevented`, `is_trusted`, `time_stamp`) are snapshotted
  from the live `ev` — plain data, free to read.
- **Subtype value fields (landed 2026-10-27)** — the full common set, each
  snapshotted conditionally (present only when the live `ev` actually carries
  it, so a mouse event bears no keyboard slots and vice versa): keyboard
  (`key`, `code`, `repeat`, `location`, `is_composing`), modifier flags
  (`alt_key`, `ctrl_key`, `shift_key`, `meta_key` — both families), and
  mouse/pointer (`button`, `buttons`, `client_x/y`, `screen_x/y`, `page_x/y`,
  `offset_x/y`). One flat `::Event` carrying the MouseEvent ∪ KeyboardEvent
  union; per-event subtypes still deferred.
- **Element-reference fields (landed 2026-10-27)** — `target`, `current_target`,
  `related_target` snapshot the referenced DOM node as *the element actor's
  address* (`#<HTML @button/1>`), minted on demand via the runtime's existing
  `tokenForNode` (DOM node → CAM address). This is the reference-field shape
  (like `prevent`/`stop`) pointed at a *durable* element actor rather than an
  ephemeral endpoint: reading the field is a free value access (a string
  snapshot, no message), and sending to the address interacts with the live
  element. Absent / non-actor targets (window, fragments) drop the field.
- **Endpoint fields** (`prevent`, `stop`, `stop_immediate`) are ephemeral
  addresses minted per fire under the HTML alias (`#<HTML @__evt_*_N>`), each
  bound to the live `ev`'s `preventDefault` / `stopPropagation` /
  `stopImmediatePropagation`, torn down on the next microtask. Invoking one is a
  fire-and-forget send that posts synchronously, so it lands in-frame.

Covered by `__tests__/html/event.browser.test.js`: the tests drive the HTML /
document actors directly over CAM (construct an element via `#new` with its
`on<event>` wired back to the test's own address, append it via the body
actor), fire a real event through Playwright's `dispatchEvent`, and inspect the
`HTML::Event` the HTML actor delivers. They assert the authority tag, the
endpoint set, the generic value fields, the element-reference fields
(`target`/`current_target` resolving to the element actor address), the
mouse subtype fields + modifier flags on a `MouseEvent`, and the keyboard
fields (`key`/`code`/modifiers) on a `KeyboardEvent` — including that each
family's fields drop out on the other family's event. No brevity source and no
inline `on*` syntax are involved; the event is consumed directly against the
actor.

**Still deferred (authoring half, feature work):** the `on*=(e) -> { … }`
surface that declares the event param and binds the delivered value to a
handler. Building it means the attr-value lexer accepting the `(params) -> {…}`
form, the parser producing the handler params, and the template-closure
synthesis stamping the param `HTML::Event` positionally. The ordering check and
its source-position prerequisite belong to that pass too.

---

## Starting point — what actually exists today

The entire event system is one code path. On element construction, an `on*`
attribute whose value is a closure address (`#<…>`) wires a native listener
(`runtime.js:1748–1767`):

```js
if (k.startsWith('on')) {
  const eventName = k.slice(2);
  const selector = v.slice(2, -1).split(' ').pop();
  el.addEventListener(eventName, () => {              // ← no event param
    route({ id: `_evt_${++subCounter}`, op: selector, to: v, from: addr });
  });
}
```

Authoring side: `onclick={ … }` parses to a `handler`-typed attr value, lifted
by `brevity.js:127–137` into a **side-effect-only** closure (no implicit
return). Payload carries it flat: `onclick: '#<main @N>'`.

Facts established by investigation:

- **Only `onclick` is exercised.** 8× `onclick={` across all html/browser
  tests, nothing else. `onclick.browser.test.js:14` says so in-source:
  *"First pass: click only, no event payload."*
- `form` / `input` / `button type=submit` exist in `tag.browser.test.js` but as
  **static attribute stamping only** — no submit wiring, no default-action
  control.
- **Zero** occurrences of `preventDefault` / `stopPropagation` / `e.target` /
  any event-payload read in source, tests, or notes. The concern was never
  written down; it lived entirely in the listener's `() =>`.

## Why the naive paths fail

The listener callback takes **no event object** (`() =>`), and the handler
fires as an async CAM message, not a synchronous callback. `preventDefault` /
`stopPropagation` are only honored *synchronously, inside* the native dispatch
frame — and by the time a routed, awaited handler runs, that window is closed.
`onclick.browser.test.js:142` pumps two `setTimeout(0)` cycles after `.click()`
precisely because state settles asynchronously.

## The load-bearing fact: `await` always yields

`await` schedules a microtask **even on an already-resolved value** —
`await Promise.resolve(x)` still suspends for a turn. Consequence: *any* `await`
before `preventDefault` throws the handler off the native dispatch frame, no
matter where the value came from. This is what rules out several tempting
designs (event-as-actor with addressed reads; synchronously-resolved replies):
if reading a field is a message (`await #send`), the read itself ends the
in-frame window before you can prevent.

Verified the dispatch path up to the handler body is synchronous, though:
`route → receive → #dispatch → @N` has no `await` before the handler's own
first `await` (`classes.js:984` `receive` is sync; `#dispatch` `:1028`
normalizes without awaiting into the `ifChain`). So a handler runs in-frame
**until its first `await`** — that part is usable.

## Decision — `Event` is a value type carrying endpoint fields

Stop making one mechanism carry two concerns. The actor framing conflated
*data* and *capability*; split them:

- **Data → value fields.** `e.key`, `e.target`, `e.type` are plain fields on a
  value. Reading is not a message → no `await` → never leaves the frame. This
  is the piece the actor model couldn't give cheaply, and it's load-bearing
  (see above).
- **Capability → endpoint fields.** `prevent` and `stop` are function pointers
  embedded in the value — addresses into the triggering process. Invoking one
  is a send to that endpoint.

Leans on existing precedent: DOM construction already stores an endpoint as a
field value (`onclick: '#<main @N>'`, `runtime.js:1757`). An `::Event` whose
`prevent`/`stop` fields hold endpoint addresses is the same shape pointed the
other way. Fits the Type model: a Type is a homeless portable shape that
constructs a value (pass-by-value), and a field may hold an endpoint address.

Rough shape (per-event subtypes like `KeyboardEvent` can come later):

```
::Event = (type: Text, key: Text, target: …, prevent: <endpoint>, stop: <endpoint>)
```

Constructed per fire by the listener wrapper: snapshot the readable fields, mint
two ephemeral endpoints bound to the live `ev`, hand the value to the handler as
`e`, tear the endpoints down when the handler settles.

### Surface syntax

Event param declared outside the closure braces, consistent with `@create = ->`
and every other param position:

```
<input onkeydown=(e) -> { if e.key == "Enter" e.prevent! }>
```

(`!` vs `()` on the endpoint call is a surface detail to settle — `prevent` is a
void side-effect, so either reads fine. `!` makes the sync-trigger visually
loud.)

## The one mechanical requirement that survives

Reads are now free, but invoking `prevent`/`stop` is still a send — and
closure/endpoint **calls currently compile with `await`** (`expressions.js:822,
839`), which would yield off-frame. So:

> `prevent` / `stop` are **void / fire-and-forget** endpoints, and their
> invocation must emit as a **non-awaited** send (`this.#send(op, addr)`, no
> `await`) — the form statement-position sends already use
> (`expressions.js:769, 915`). The Promise executor posts synchronously; `route`
> delivers to the ephemeral endpoint, which calls native
> `event.preventDefault()` in-frame; the `self` ack defers and is ignored.

This aligns with the existing [void-return](void-return-2026-05-07.md) work (a
void endpoint call has no reply to wait for). It is the *entire* remaining
obligation — no synchronous-actor kind, no sync-return `receive` convention, no
type-directed sync dispatch. All of that evaporated with the value-field split.

## The ordering rule (compiler check)

> Every `prevent!` / `stop!` must lexically precede the handler's first
> outgoing **async** (reply-consuming) send. Reads don't count — they're value
> access. A fire-and-forget send before `prevent!` is fine (posts in its
> executor, never suspends). Any awaited send before `prevent!` — including one
> inside an earlier `if` branch — is the error.

Lexical order is the sound first-pass approximation: an `await` in a branch
*above* the `prevent!` is lexically before it, so the rule rejects exactly the
unsafe cases without control-flow dominance analysis. The compiler already
distinguishes reply-consuming (`await …#selfSend` / `BvObject.pack(await …)`)
from fire-and-forget sends (`isAsyncSend`, `classes.js:506, 516`), so the check
reuses existing knowledge. (Edge case to document: a local helper that hides an
`await` — punt for v1.)

## Asymmetric portability — state it in the type's docs

The value is a portable Type: ship it across a boundary and `key`/`target`
travel fine. But `prevent`/`stop` are process-local, single-tick addresses —
call them from another process or a later turn and the message routes back
correctly but arrives after native dispatch is over, so they degrade to no-ops.
That's not a flaw; it's the same contract the platform enforces (you can't
`preventDefault` from a later tick either). The type is portable; the
*effectiveness* of two fields is local and in-frame.

## Open prerequisite — source positions

The ordering check can run on today's AST, but it **cannot point at a line**.
Tokens are emitted as `{ type, value }` only (`lexer.js:187–357`); the AST
carries no spans (`parser.js` has only scan-local indices). So "map the calls
back to source" is a request for span tracking the toolchain does not have yet.
Two ways:

- **Add offset tracking** (lexer char-offset → token → AST node). Bigger than
  this feature, but every future diagnostic wants it, and this becomes its first
  real customer.
- **Ship coarse first**: key the error to the handler (`onkeydown on <input>`)
  and the op name, no line number; add offsets later.

Leaning toward minimal offset tracking now rather than accruing position-less
diagnostics — but it's a real scope call.

## Staging

1. **Minimal.** `Event` value with `prevent`/`stop` endpoints only (no field
   reads yet); `(e) ->` param; non-awaited emission for the two endpoints;
   listener `() =>` → `(e) =>`. Covers unconditional prevents (`onsubmit`, link
   interception) — the bulk of real need. **(Delivery-side landed 2026-10-27;
   authoring `(e) ->` param still deferred.)**
2. **Full.** Add readable fields as value-snapshot fields, enabling conditional
   prevention. No new async machinery — reads are plain value access.
   **(Landed 2026-10-27, delivery side.)** The emitted value now carries the
   generic fields, the keyboard/mouse/modifier subtype union, and the
   `target`/`current_target`/`related_target` element-reference fields (element
   actor addresses via `tokenForNode`). Consuming them from brevity source is
   the deferred authoring half.

## What this reuses vs. adds

- **Reuses:** Types + value fields; endpoint-as-field-value (DOM closures);
  fire-and-forget statement-position send emission; the synchronous
  `route → receive → #dispatch` prefix; void-return semantics.
- **Adds:** non-awaited emission for void endpoint calls; per-fire ephemeral
  endpoint registration + teardown; the ordering check; (prereq) source spans.
