# CAM Test Messages

LLM orientation: this directory covers test-only CAM messages used by the test
harness. These messages are for inspection and controlled mutation.

## `test.get`

Reads actor state:

```json
{ "id": "1", "test": { "get": "count" }, "from": "t" }
```

Can target child actors with a dotted target path in tested cases.

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
validation in tested cases, so no `bv-a` is required.

## LLM Rules

- Treat these as test harness messages, not ordinary application protocol.
- Use them when documenting tests or examples that inspect internal state.
- Use normal public handlers for application-facing behavior.
