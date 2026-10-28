# `!` is part of the name — invoking with a bang the declaration lacks should error

Status: **IMPLEMENTED 2026-10-27, green js/rust/erlang.** Found while testing
lambda-ref invocation (see
[session-2026-10-27-lambda-param-inference](session-2026-10-27-lambda-param-inference.md)).

## Outcome

Investigation showed the hole was **only type reference fields**: the call site
silently stripped the bang and resolved the no-bang field. Interface methods
(`src/validate.js` inferCall / remote-call existence check) and class methods
(`checkMethodCall`, ~2392) *already* resolved by the full name including the
bang, so both already rejected a spurious bang and a missing bang (bidirectional).

Fix: one guard in `checkTypeFieldAccess` (`src/validate.js` ~1219) — after the
field resolves, a trailing `!` throws (a type field is never bang-named; a value
field "is a value, not a function", a reference field "is declared without '!'").
Validation-only; no codegen changes (codegen already handles the valid forms).

Migrated 26 reference-field call sites `.field!` → `.field()` across
`reference_fields`, `cross_module_ref_fields`, `lambda_param_inference`,
`arrow_block_lambda` (behavior-preserving — discipline is from the `-> .`
signature, not the bang). New `__tests__/types/bang_name_enforcement.test.js`
(10 tests: type field spurious/value bang, interface bidirectional, class
spurious bang). Full js green (2698); rust+erlang green on the affected +
enforcement suites.

**Declaration-side, left as-is (not a hole):** the parser already rejects
bang-named type fields (`ping!: () -> .`, `code!: Integer`) and bang-named class
handlers (`@poke!`); only interface methods can be declared with a bang
(`focus!`). So "only a function can end with a bang" holds, but bang-*naming* is
currently available only to interface methods. Enabling it for class methods /
function-typed fields is additive parser work — a separate choice, not required
to close this hole.

## The rule we want

Per [capability-sigils-2026-05-06](capability-sigils-2026-05-06.md) (L84–88,
L95, L101), postfix `!` survives as a **method-name suffix convention for
mutating / destructive operations** (`append!`, `peers.append!(x)`). The bang
is **part of the operation's name** — it is declared and invoked identically —
not a tack-on call-site sigil. (Its broader future is still open: that note's
L147 asks whether `!` gets repurposed at all.)

Therefore the bang at a call site must match the declared name:

```
::Panel = (onpress: (s: Signal) -> ., label: Text)   // name has no bang

p.onpress!(sig)   // should be a COMPILER ERROR — no such member `onpress!`
p.onpress(sig)    // ok — matches the declared name
```

And the converse: a field/method declared *with* a bang (`onpress!: …`) should
be callable only as `p.onpress!(…)`, not `p.onpress(…)`.

## Current behavior (the gap)

Validation does **not** enforce this. Both `p.onpress!(sig)` and
`p.onpress(sig)` compile against an `onpress:` (no-bang) declaration — the bang
is silently tolerated / stripped rather than checked against the member name.
A quick probe (2026-10-27) confirmed both forms compile on the JS target.

## Not to be confused with: the silent-endpoint call glyph (separate, also open)

Whether a *silent* reference (`-> .`) is invoked as `e.prevent!` vs
`e.prevent()` vs some capability-sigil form is a **different** open question,
explicitly flagged in
[reference-fields-in-types-2026-10-26](reference-fields-in-types-2026-10-26.md)
(L301–303: "Call-site glyph … `!`/`()` as a surface detail; unify here"). The
reference-fields note and `__tests__/types/reference_fields.test.js` use
`v.field!` for silent endpoints in their examples, but that glyph is **not**
settled. Silentness itself IS settled: it comes from the `-> .` return type
(that note, L304–305), never from the bang.

So two distinct `!` concerns remain unresolved and should be reconciled
together:
1. **This note:** `!` as a name-suffix — enforce that the call-site bang matches
   the declared member name.
2. **The glyph question:** how a silent endpoint is spelled at the call site.

If (2) lands on `!` as the silent-invoke glyph, it would collide with (1)'s
name-suffix meaning — hence the notes' call to unify rather than decide
per-feature.

## Scope when implemented

- Member-access / call validation: reject a trailing `!` on a `.member` access
  (field or method) whose resolved declaration name has no `!`, and vice-versa.
- Applies to type reference fields, class methods, and interface members.
- Decide interaction with the silent-endpoint glyph (2) before committing, so
  the two uses of `!` don't contradict.

## Concrete plan (2026-10-27 investigation)

**Root cause.** The parser keeps `!` *in the member name*
(`DotCallExpr.method = "onpress!"`, `DotAccessExpr.property = "dismiss!"` —
parser.js:2063–2167). validate + all three codegens strip it
(`raw.endsWith('!') ? raw.slice(0,-1)`) and resolve on the stripped name, using
the bang only to select fire-and-forget discipline. No check that the
declaration carries the bang.

**Why it's clean to enforce.**
- Type *fields* can never carry `!` (syntax is `name: Type`) → any bang on a
  type-field access is spurious by construction.
- Service/DOM *methods* are declared WITH the bang (`focus!:`,
  `set_attribute!:`, `click!:`, `append_child!:` — browser/runtime.js;
  dispatch `@focus!`). `.focus!()` matches → unaffected.
- Builtin List/Text/Blob methods (`.append!`, …) parse to their own node types
  with their own bang rules (parser `assertBangValidRef`) — separate path,
  unaffected.
- Reference-field discipline is from the signature (`/->\s*\.\s*$/` → silent;
  rust/expressions.js:29), NOT the bang. So `v.dismiss!` → `v.dismiss()` is
  behavior-preserving, and this enforcement *settles* open question (2): `()`
  invokes a silent endpoint; `!` is reserved for name-suffixed members.

**The fix (primary, type reference fields).** `src/validate.js` ~1218–1224
(`checkTypeFieldAccess`) already has `raw` / `bang` / `name` in scope. After the
field-exists check (`disc !== null`), if `bang` is true → throw
("`'<name>'` on `'::<Type>'` is declared without `!`; invoke it as
`.<name>(...)`"). Order AFTER the "has no field" throw so `.bogus!` still
reports the missing field; decide ordering vs. the value-field "not a reference"
throw (1228) for the `p.x!` case.

**Test instances to migrate** (`.field!` → `.field()`, behavior-preserving) —
26 across 4 files: `types/reference_fields.test.js` (9, incl. the runtime suite
and the `p.x!` message), `types/lambda_param_inference.test.js` (9),
`types/cross_module_ref_fields.test.js` (7),
`functions/arrow_block_lambda.test.js` (1). Plus prose: the
`reference_fields.test.js` header and the `e.prevent!` examples in
[reference-fields-in-types-2026-10-26](reference-fields-in-types-2026-10-26.md).

**Open decisions.** (a) converse — error on omitting a required `!`
(`.focus()` for `focus!`)? (b) scope — type fields only, or also
class-method / interface-member calls (compare the full name incl. bang)?
(c) `p.x!` message precedence (spurious-bang vs not-a-reference).

**Verification.** The 4 migrated suites + full js/rust/erlang; check the
`.bogus!` (missing field) and `p.x!` (value field) negative-test messages.
