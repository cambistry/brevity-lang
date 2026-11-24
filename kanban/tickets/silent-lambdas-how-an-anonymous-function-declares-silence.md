---
status: todo
created: 2026-10-30
---
# Silent lambdas: how an anonymous function declares silence once the terminating dot is gone (speculative)

**Background.** The silent-suffix ticket makes a silent function's silence part of its name (sfn.) and makes the terminating . in a body illegal. Silent reference fields follow the same rule (onpress.: (s: Signal) -> .). Anonymous lambdas fall through the gap. Today a lambda passed to a silent slot is marked silent only by the terminating dot:

```brevity
Panel(onpress.: (s) { s.code . }, label: "x")
```

Once that dot is illegal, a lambda has no name to carry the suffix and no body mark. This ticket decides how an anonymous function becomes silent. It depends on the silent-suffix ticket.

**Leading proposal: silence comes from the expected type.** A lambda written where a silent function type is expected _is_ silent. Examples:

- a silent field's argument: onpress.: (s) { … }
- a silent parameter: watch(on.: (s) { … })
- a silent-typed binding: f. = (s) { … }

This extends the existing lambda-param inference (notes/session-2026-10-27-lambda-param-inference.md), which already pushes param types from the slot's signature into the lambda. The output side would be pushed the same way.

The rules would be:

- The lambda's final value is discarded, and return value inside it is an error ("this lambda fills silent slot onpress.; it can't return a value").
- A lambda with no expected type returns a value. To get a standalone silent lambda, bind it to a dotted name: f. = (s) { … }.
- If a lambda's body produces no value and it's passed to a value-expecting slot, the existing type mismatch applies. Nothing new is needed.

**Speculative alternatives** to evaluate before settling:

1. **A dot on the parameter list:** (s). { … }, (). { … }. It's explicit and readable without context. But it sits next to . member access and the lineal . closer, and it's visually odd.
1. **A silent arrow form:** (s) -> . { … }, which reuses the type notation inline. It matches how -> . reads in types, but it conflicts with the decision that -> is purely the params-to-body arrow (notes/return-keyword-and-arrow-2026-10-26.md).
1. **Inference only, no explicit form.** Any lambda that can only ever be called silently is silent. This is the simplest option, but silence then can't be seen at the lambda itself. That's the problem the silent-suffix ticket set out to fix for named functions.
1. **Inference plus an optional explicit form** (inference, plus option 1 or 2 when a lambda has no expected type). This avoids forcing a binding, but there are two ways to say the same thing.

**Questions to answer**

- **Lambdas passed through Anything-typed or untyped values:** there's no expected type. Should such a lambda be value-returning, or should passing it to a silent slot later be a runtime error?
- **Overloaded or union slots:** what if a slot accepts both (s) -> . and (s) -> (T)? Is that ambiguous, an error, or does the body decide?
- **Lambda-ref invocation** (notes/session-2026-10-27-lambda-ref-invocation.md): a local holding a silent lambda must be named f. and called f.... Check that this follows from inference without special cases.
- **Captured lambdas across actors:** a silent lambda sent as a reference becomes a fire-and-forget endpoint. Confirm the wire op carries the suffix the same way named silent functions do.
- **Trailing-block syntax** (x.subscribe |args| { … }, and blocks after calls): does silence come from the receiving signature in the same way?

**Migration.** Every (…) { … . } lambda in tests and docs becomes either:

- (…) { … } in a silent slot, or
- a dotted binding.

The existing tests in __tests__/types/lambda_param_inference.test.js (onpress: (s) { … . }) are the first cases to convert.

**Tests**

- Silence inferred from a silent field, a silent parameter and a silent binding.
- A return value in an inferred-silent lambda is rejected.
- A lambda with no expected type returns a value.
- A silent lambda bound to a dotted local and called with ....
- A union or overloaded slot (whatever is decided).
- All targets.
