# Test API migration plan

2026-04-04

## Background

The `__tests__/cam_test/` suite defines and tests four test-harness primitives:

| Primitive | What it does | Returns? |
|-----------|-------------|----------|
| `test.get` | Reads a state var by name, returns value + `bv-a` type | Yes |
| `test.set` | Dispatches the private `::set` handler | No (fire-and-forget) |
| `test.update` | Dispatches the private `::update` handler | No (fire-and-forget) |
| `test.op` | Calls any function (public or private) by name, with args | Yes |

All four support `target` for child/nested actors (e.g. `target: 'b'`, `target: 'o.inner'`).

## Guiding principle

The test API is for when **the test harness itself** is the one reaching into actor state. It should be used to improve expressivity in two situations:

1. **Asserting interior state** — the harness needs to verify what landed in a state var after sending messages. `test.get` says "I'm inspecting" more honestly than a `@get` wrapper that masquerades as part of the actor's API.

2. **Setting up preconditions** — the harness needs to put an actor into a specific state before exercising the thing under test. `test.set`/`test.update` say "this is test setup" without routing through a public function that may have its own side effects.

3. **Calling private functions directly** — `test.op` for unit-testing a private function without wrapping it in a public shim.

Wrapper functions written inside Brevity code (e.g. `b <- 42; :value = b.get()`) are **not scaffolding** — they exercise real language behavior (dispatch, return values, the `<-` operator). Those stay. The line is: if the wrapper exists so that *Brevity code* can observe a result through normal dispatch, it's testing the language. If it exists so that *the JS test harness* can peek at state, it's scaffolding the test API can replace.

## What qualifies for migration

A wrapper qualifies if **all** of these are true:
- It is called from the test harness (via `{ op: '@get' }` in JS), not from within Brevity code
- Its only purpose is to expose private state or call a private function
- Removing it doesn't reduce coverage of any language feature (dispatch, typing, return values)

A wrapper does **not** qualify if:
- It is called from within a Brevity function (`b.get()`, `s.pos()`) — that tests in-language dispatch
- It tests public API shape (return types, named return values)
- It is part of a behavioral round-trip (send → external call → response → return)

## Files and candidates

### Harness-level assertions (use `test.get`)

These have top-level `@get` wrappers called only from the JS harness to verify state after mutations.

| File | Wrapper | Used from JS? | Used from Brevity? | Migrate? |
|------|---------|--------------|-------------------|----------|
| `marshal/capture.test.js` | `@get` in "state after mutation" | Yes (1 test) | No | Yes |
| `marshal/capture.test.js` | `@noop` (satisfies "has public fn") | Yes | No | Yes — `test.get` removes the need |
| `marshal/capture_hydrate.test.js` | `@get` | Yes (all 3 blocks) | No | Yes |
| `marshal/hydrate.test.js` | `@get` | Yes | No | Yes |
| `cam_test/set.test.js` | `@get`, `@getP`, `@getLabel` | Yes | No | Already uses `test.get` alongside — remove leftover `@get` wrappers |

### Harness-level preconditions (use `test.set` / `test.update`)

Tests that need an actor in a specific state before exercising the real behavior. Currently achieved by calling public setters from the harness.

These are less common — most state setup happens through `@inc` or similar functions that are themselves under test. Candidates are tests where the setup step is incidental to what's being verified.

| File | Pattern | Migrate? |
|------|---------|----------|
| `marshal/capture_hydrate.test.js` | `sendAsync({ op: '@inc' })` x3 to build state before capture | Maybe — `@inc` is itself part of the tested behavior here (state mutation round-trip). Probably leave. |

### Private function testing (use `test.op`)

No current tests wrap private functions in public shims just for harness access — private functions are always tested through the public functions that call them. If future tests need to unit-test a private function in isolation, `test.op` is the tool.

### Leave alone

| File | Why |
|------|-----|
| `operators/set.test.js` | `Box.@get`, `Store.@pos`, `Counter.@get` are all called from Brevity code (`b.get()`, `s.pos()`) — tests exercise `<-` dispatch + getter round-trip. |
| `operators/update.test.js` | Same — `Person.@get`, `Store.@pos`/`@named` called via `a.get()`, `s.pos()`. |
| `constructors/sugared.test.js` | `c.get()`, `p.sum()`, `g.hello()` — in-language dispatch. |
| `constructors/wrapped.test.js` | `inner.double()` etc. — tests wrapped child dispatch. |
| `constructors/delimited_form.test.js` | In-language getter calls. |
| `constructors/ephemeral_process.test.js` | In-language. |
| `keywords/ref.test.js` | Self-contained public functions, no top-level wrappers. |
| `cam/external_send.test.js` | No wrappers — tests outgoing message shapes. |
| `cam/interop.test.js` | Wrappers are part of the interop contract. |
| `services/*.test.js` | Compile-only or manifest extraction. |
| `types/type_dependency.test.js` | Compile-time. |
| `cam_test/*` | These ARE the test API tests. |

## Migration steps

### Step 1: Validate `test.*` with `createActor`/`sendAsync`

The `cam_test/` suite uses `expectBehavior`. The marshal tests use `createActor` + `sendAsync`. Confirm `test.get` works via `sendAsync`:
```js
await actor.sendAsync({ id: 'x', test: { get: 'count' }, from: 't' });
const re = actor.posts.find(o => o.id === 'x');
expect(re).toEqual(expect.objectContaining({ 'bv-a': 'Integer', re: 3 }));
```

### Step 2: Migrate marshal tests

`capture.test.js`, `capture_hydrate.test.js`, `hydrate.test.js`:
1. Remove `@get` wrappers from scripts
2. Replace `{ op: '@get' }` harness calls with `{ test: { get: 'varname' }, from: 't' }`
3. Update expected outputs: `test.get` returns `{ re: value, 'bv-a': 'Type' }` (bare value, flat type) vs the wrapper pattern's `{ re: { name: value }, 'bv-a': { name: 'Type' } }` (named fields)
4. Where `@noop` existed only to satisfy "actor has a public fn," check whether the test framework still requires one — if so, keep a minimal `@noop`

### Step 3: Clean up `cam_test/set.test.js`

Already uses `test.get` for verification but still defines `@get`/`@getP`/`@getLabel`. Remove the wrappers that are no longer called.

## Output format difference

Current `@get` wrapper returns named fields:
```js
{ re: { count: 3 }, 'bv-a': { count: 'Integer' } }
```

`test.get` returns bare value + flat type:
```js
{ re: 3, 'bv-a': 'Integer' }
```

Expected outputs will change shape in migrated tests.

## Estimated scope

~4-5 files to touch, ~10-15 test cases. Small, low-risk changes focused on the marshal/ tests and cam_test/ cleanup.
