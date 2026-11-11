# CAM Test Messages

LLM orientation: this directory covers test-only CAM messages used by the test
harness. These messages are for inspection and controlled mutation.

## `test.get`

Reads actor state:

```json
{ "id": "1", "test": { "get": "count" }, "from": "t" }
```

Reads a cell by its wire label (`.x`, `@x`). Targets child actors with a run of labels (`.b`, `.o.inner`) in tested cases.

## `test.set`

Exercises an actor's `set` path through the test harness. Tested cases include:

- single positional set
- positional plus named args
- setting child actor state by target
- nested target paths

## `test.update`

Exercises an actor's `update` path through the test harness.

## `test.op`

Dispatches public or private ops directly for tests. It bypasses normal schema
validation in tested cases, so no `ty` is required.

A protected op is spelled with a leading `.` (`.double`), as on the wire. A `to`
is forwarded, so a protected cell is set from inside by
`{ "test": { "op": [[5], "#set"], "to": ".val" } }`.

## LLM Rules

- Treat these as test harness messages, not ordinary application protocol.
- Use them when documenting tests or examples that inspect internal state.
- Use normal public handlers for application-facing behavior.
