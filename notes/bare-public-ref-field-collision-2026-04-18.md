# Public-vs-private ref field-name collision in JS codegen (2026-04-18)

Latent bug surfaced while planning subscribe implementation. Pinning here for later triage; not fixed yet.

## The collision

The parser desugaring for a public reactive cell:

```
@x *Integer = 0
```

produces, at `src/parser.js:2499`:

```js
constructorBody.push(AST.refDecl(op, typeName, value));  // op === "x"
```

— a `refDecl` with the bare name `x`, identical to what a private/actor-local ref declaration produces:

```
x *Integer = 0
```

(also yielding `refDecl { name: "x" }`).

The JS codegen field section at `src/codegen/javascript/classes.js:605` then emits a class field per state var:

```js
const stateFields = [...allFieldNames].map(n => `  #${n}`).join('\n');
```

Both decls want the same JS private field `#x`. If both appear in the same actor, the codegen output has a duplicate field declaration — a syntax-level collision at the JS class-body level, not even a silent overwrite.

## Why it hasn't bitten yet

Public ref cells (`@name *Type`) were a recent addition. Most existing code uses either the public form *or* the bare private form, not both for the same name in the same actor. So the tests haven't exercised the collision path.

## What to check

- Does `addRef(op)` at `src/parser.js:2498` (or equivalent bookkeeping in `parseActorBody`) already reject a second `refDecl` with the same name, throwing at parse time? If so, the collision is caught early but with a confusing error message — user wrote `@x` and a private `x` separately, gets a "duplicate ref" error they may not understand.
- If parser doesn't reject it, we emit malformed JS (duplicate `#x` in the class body) — probably a compile-time error from the JS engine, but a bad one.
- Either way, the error story is poor and the name-mapping intent is muddled.

## Framing the fix (not decided)

Options roughly in order of scope:

1. **Parse-time reject with a clear message.** "Cannot declare both a public `@x` and a private `x` in the same actor — they resolve to the same underlying state cell." Cheap, unambiguous, keeps current codegen unchanged. Closes the door on having both, which may or may not be desirable long-term.

2. **Rename one side in codegen.** E.g., public `@x` backs to `#_pub_x`, private `x` backs to `#x`. Preserves the ability to have both. Adds a small convention to remember when debugging generated JS.

3. **Unify on one backing, accept that public is just "published private".** `@x *Type = 0` conceptually *is* the same cell as a private `x *Type = 0`, just with getter/setter surfaced on the interface. Under this view, writing both in the same actor is semantically nonsense (you already have one cell). Parse-time reject + documentation of the conceptual model.

My read: (3) is the cleanest. `@x` is not a different cell than `x` — it's the same cell, surfaced publicly. The fix is (1) with (3) as the explanation the error message gives.

## Why flagging now matters for subscribe work

The subscribe implementation adds per-cell subscriber storage under a `#_`-prefixed internal field (e.g., `#_cellSubs`), keyed by cell name. That storage lives in the runtime-internal namespace and does not participate in this collision. So subscribe work can proceed without waiting on the resolution here.

But: once subscribe exists, the user-facing surface expands. If the public/private collision is resolved by renaming rather than rejection, the subscribe dispatch handler needs to know which backing field name to read (since notifications reach for current value on the backing cell). A rename-based fix would ripple into the subscribe codegen. Resolution option (1) keeps subscribe work unaffected — worth weighing when this is actually fixed.

## Files involved

- `src/parser.js:2487–2512` — public-ref desugaring (`refDecl` with bare name)
- `src/parser.js:~1878–1892` — `parseTypedAssign`, where bare `x *Type` originates
- `src/codegen/javascript/classes.js:597–607` — field section emission
- `src/codegen/javascript/statements.js:~83` — `set` statement mutation target
