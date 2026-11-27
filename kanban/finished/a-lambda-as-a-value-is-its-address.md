---
created: 2026-11-27
---
# Fix: a lambda replied or held in a cell goes out as a bare internal label

An address in a value is bracketed and relative to the sender: a class is `#<:C>`, a named function
`#<:~f>`, and a lambda passed into a call or a type field `#<:@N>` (`types/lambda_ref_invocation.test.js`).
A lambda replied, or held in a `*Function` cell, isn't, and the targets disagree:

```brevity
transform *Function = (x Integer) -> x * 3
@cell = () -> transform
@lam = { g = (k Integer) -> k + 1; return &g }
```

| reply | js | erlang | rust |
|---|---|---|---|
| `@cell` | `~_lambda_1` | `~_lambda_1`, ty `Function` | `~_lambda_pre_init_transform`, ty `Function` |
| `@lam` | a raw JS function (not a wire value) | `~_lambda_0` | `~_lambda_0` |

`marshal/capture.test.js` ("function reference state") asserts the bare form too:
`expect(re['~transform']).toMatch(/^~_lambda_/)`.

Expected, on js, erlang and rust: a lambda as a value on the wire is its relative self-address,
`#<:@N>`, with the same dispatch arm a wire lambda has, and the same `ty` on every target. The
capture test asserts that form, and a captured function restores to one that still answers.

**Decided (2026-11-27):** a lambda value is tagged with its signature, in the tagged form
`['%f', { args, re, writes }]` that `test.get` gives a named function. A lambda in a `*Function`
cell with no signature declared is tagged `Function`.
