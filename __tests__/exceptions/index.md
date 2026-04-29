# Exceptions and Errors

LLM orientation: this directory covers runtime error replies and unhandled
message replies.

## Unhandled Ops

When no public handler matches an op, the actor replies with `ex`:

```json
{ "id": "1", "ex": { "@missing": "unhandled" }, "to": "c" }
```

This applies to plain string ops and payload-shaped ops.

## Runtime Errors

Runtime errors also reply with `ex`, but the value is `"error"`:

```json
{ "id": "1", "ex": { "@arityMismatch": "error" }, "to": "c" }
```

Tested runtime errors include list destructuring arity mismatches and taking a
head from an empty or too-short list.

## LLM Rules

- Use `unhandled` for dispatch miss examples.
- Use `error` for runtime failure examples.
- Keep line ranges and examples narrow when describing failure behavior.
