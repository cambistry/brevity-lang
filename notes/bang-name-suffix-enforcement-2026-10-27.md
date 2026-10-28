# `!` is part of the name — invoking with a bang the declaration lacks should error

Status: **queued, not implemented.** Captures a validation gap found while
testing lambda-ref invocation (see
[session-2026-10-27-lambda-param-inference](session-2026-10-27-lambda-param-inference.md)).

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
  Message: `'<Type>' has no member 'onpress!' (did you mean 'onpress'?)`.
- Applies to type reference fields, class methods, and interface members.
- Decide interaction with the silent-endpoint glyph (2) before committing, so
  the two uses of `!` don't contradict.
