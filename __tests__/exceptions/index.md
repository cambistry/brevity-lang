# Exceptions and Errors

LLM orientation: this directory covers runtime error replies and unhandled
message replies.

## Unhandled Ops

When no public handler matches an op, the actor replies with `ex`:

```json
{ "id": "1", "ex": { "missing": "unhandled" }, "to": "c" }
```

This applies to plain string ops and payload-shaped ops.

## Runtime Errors

Runtime errors also reply with `ex`, but the value is `"error"`:

```json
{ "id": "1", "ex": { "arityMismatch": "error" }, "to": "c" }
```

Tested runtime errors include list destructuring arity mismatches and taking a
head from an empty or too-short list.

## Failed `as`

A failed `as` replies with `ex`, and the value names both types:

```json
{ "id": "1", "ex": { "go": "as Integer: got Text" }, "to": "c" }
```

The message goes on the handler the `as` failed in, including a handler on an
actor. A call that receives a failure fails in turn with `error`, whether it called
another actor, another handler or a function. The actors keep their state and go on
answering.

A failed `as` in a class's constructor block fails the construction: the calling handler
reports `error`, and so does `$new`, under `$new`. No actor is made and no address
is taken.

## LLM Rules

- Use `unhandled` for dispatch miss examples.
- Use `error` for runtime failure examples.
- Keep line ranges and examples narrow when describing failure behavior.
