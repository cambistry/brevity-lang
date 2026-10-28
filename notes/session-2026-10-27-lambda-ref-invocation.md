# Session 2026-10-27 — wire-correct invocation of locally-constructed lambda refs

Status: **implemented, green on js / rust / erlang, no regressions.** Follow-on
to [session-2026-10-27-lambda-param-inference](session-2026-10-27-lambda-param-inference.md)
(which did the type *inference*). That work proved a callback-slot lambda
*compiles* and lowers; this work makes it actually *run through CAM*.

Driving use case (the user's framing): an actor passes a type-checked lambda
reference to a remote (e.g. a DOM prop hosted by the HTML actor); the remote
holds a **fully-qualified reference back to our lambda** and invokes it through
CAM. Tested with fictional `Widget` / `Signal` / `Panel` — no DOM, no browser.

## The gap this closed

A lambda handed to a callback slot was lowered to a bare dispatch label
(`"_lambda_0"`) stored in the type field / sent as the call arg. Invoking it
fired a message *to that label as if it were a remote address* — so it escaped
the actor and the lambda never ran. C3 (remote-call lambda args) had never been
spawn-tested, so this was invisible.

## Representation (all three targets)

A lambda in a **routed position** — a type-field value or a cross-actor call
argument — is now:
- lowered to a synthesized **`@N` dispatch handler** (numeric selector, reusing
  the DOM closure-prop convention; the internal `_lambda_N` name is kept for
  capture-field identifiers), and
- encoded as a **local-form self-address `#<@N>`**.

The host's perspective translation promotes `#<@N>` → `#<selfAddr @N>` as the
carrying message leaves the actor (`rewriteLocalAddresses`, matching the
`[@#:]` discriminator), so a remote gets a reference it can route back through.
Invoking the field **locally** self-dispatches: the ref-field send recognizes a
local-form `#<@…>` target (no path) and loops back to our own dispatch instead
of posting outward. Non-routed lambdas (`over`/`reduce` fn args, self-send
private-fn args) keep the bare `_lambda_N` local-dispatch label — unchanged.

Silentness comes from the slot's `-> .` return type (shared `validate.js`
change — a lambda filling a silent slot is itself silent, so its arm yields no
reply). Members are called by their **declared names** (`.onpress(sig)`,
`.dismiss()`), no bang — the bang is a separate, unsettled concern, see
[bang-name-suffix-enforcement-2026-10-27](bang-name-suffix-enforcement-2026-10-27.md).

## Per-target changes

**Shared** — `src/validate.js`: `callbackOutputType()` + silent propagation
(`fnNode.returnType = '.'` when the slot is `-> .`).

**JS** — `codegen/javascript/expressions.js`: `genLambdaArgLabel({wire})`
(selector + `#<@N>` value); wire at the TypeConstruction field + `argWireVal` +
destructured/remote-instance call args. `codegen/javascript/classes.js`:
arm keyed on `selector || name`; `#fire`/`#send` self-dispatch on local-form
`#<[@#:]`; `needsPreamble` counts nested lambdas (a latent `BvObject is not
defined` on spawning a lambda-bearing remote-call actor — the Object preamble
was gated only on the enclosing handler's own body).

**Erlang** — `codegen/erlang/types.js`: `erlGenLambdaArgLabel({wire})`.
`program.js`: arm keyed on `selector || name`. `expressions.js`:
`genRefFieldSend` self-dispatches via `self_send` on a local-form address;
wire at TypeConstruction field + `erlArgHelpers.argVal`; **`erlSendVars` gained
a per-send `locsig` var** (a fixed `LocSig` pattern name collided across two
sends in one body — "variable unsafe in 'case'"). `preambles.js`:
`bv_object_pack` excludes a trailing `__type` map from the named-args slot.

**Rust** — `codegen/rust/expressions.js`: `rustLambdaWireRef()`; wire at the
TypeConstruction field + `genArgValWrapped`; ref-field send self-dispatches via
`self.self_send` on a local-form address. `handlers.js`: arm keyed on
`selector || name`. `types.js`: `BvObject::pack` excludes a trailing `__type`
map from named-args.

### The latent `__type`/named-args bug (erlang + rust)

Both packers treated a trailing object/map as named-args. A lambda
self-dispatch passes `[signalValue]` — a one-element list whose element is a
`__type`-tagged Signal map — so the packer bucketed it as named, leaving
positional empty and the lambda param null. Fixed to exclude `__type` maps
(JS already did this via its `__type`/receive/cons checks). Genuine latent bug,
not lambda-specific.

## Deferred

- Capturing lambdas in *remote-arg* position (erlang `erlArgHelpers` is called
  with `null` typeEnv/sCtx on the direct-dep path; non-capturing is fine, which
  covers the event-handler shape).
- Passing a lambda to a **child/peer** actor (vs. a remote dependency or type
  field) still uses the bare label — out of scope, noted.
- True perspective-translation of `#<@N>` in-codegen for rust/erlang (no
  in-process relay — the host does it; tests model the promotion explicitly).

## Files
- `__tests__/types/lambda_ref_invocation.test.js` (NEW) — 4 tests: generic +
  typed lambda in a service-hosted type field invoked locally; lambda passed to
  a service method, outgoing self-reference asserted, then invoked back through
  CAM.
- `src/validate.js`; `src/codegen/{javascript,erlang,rust}/…` as above.

## Verification
New test 4/4 on js / rust / erlang. No regressions: js all dirs green; erlang
125 suites (0 fail); rust 125 suites (0 fail). Lint: 0 errors; 6 pre-existing
`no-useless-assignment` warnings, none in added code.
