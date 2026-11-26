---
status: investigation
created: 2026-11-06
---
# Investigate: a bare zero-arity lambda in an untyped slot silently becomes a call

**Today:** since parens became optional on zero-arity calls (notes/zero-arity-calls-2026-11-06.md), a bare name of a function is a call. The function itself is &f. That's settled. The cost is that some code that used to pass a function now passes the function's result, and nothing reports it.

Example: __tests__/core_types/structure.test.js, @constructClosure:

```brevity
x Integer = 10
f = { x }
s Object = Object(fn: f)     // stores 10, not the function
:fn = s
result Integer = fn()        // fails at run time
```

This compiled cleanly. It failed only at run time, as an ex from the handler. The fix was Object(fn: &f).

**Today (where it's caught):**

- A slot typed Function or (…) -> (…): "use &f".
- A function that takes args, used bare: "'f' takes arguments — call it 'f(…)', or use &f".
- f as Function: "the function itself is '&f'".

**Today (where it isn't):**

A zero-arity lambda local, or a zero-arity file function, used bare where nothing says a function is wanted:

- Object constructor fields: Object(fn: f).
- Args to untyped params: apply = (n, f) { … }; apply(5, g).
- Named returns and list elements: return fn: f, [f, g].
- Assignment: h = f (now binds the result).
- Possibly type construction with a reference field, emits, and set values.

**Questions to answer**

1. Which of these positions does the compiler have enough information to flag? A bare name that resolves to a function is easy to spot, but the hard part is knowing that the slot wanted a function.
1. Should a bare zero-arity function in an untyped slot be:
- (a) a call, silently, as now;
- (b) a call, with a warning (we have no warning channel; see mutation-suffix follow-ups);
- (c) an error asking for either f() or &f, so the author states which they mean;
- (d) an error only for lambda locals, but a call for declared functions (get, @get)? The surprise mostly comes from locals that were plainly built to be passed around.
1. If it's (c) or (d), how noisy is it? Survey the corpus for bare zero-arity calls in argument and field positions that are meant as calls.
1. Do later uses help? fn() on something bound from that slot shows a function was expected, so the error could point back to where the result was stored. Is that worth tracking, or too clever?
1. Do the three targets agree on the run-time failure (ex on JS)? Is the message usable?

**Deliverable**

A short design note in notes/ with a recommendation, the positions it covers, and a corpus count. Then implement it, with tests in __tests__/functions/zero_arity.test.js.
