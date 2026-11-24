---
status: done
created: 2026-11-02
---
# Extend the annotation check

**Problem:** A caller's annotation must now hold for every return path of the function it calls, but that check only covers a value that is a direct call to a function with a single signature. These cases still go unjudged:

```brevity
x Integer = y            // not a call
x Integer = f() + 1      // a call inside an expression
x Integer = over(1)      // an overloaded function
t = Thing()
t.nope()                 // a member of a dependency instance held in a local
```

The last case is a member check, not an annotation check. It's a compile-time gap in the same area and can be split out. It applies when the dependency is declared inline; a class reached through Svc.W(), s.W() or (:W) is already checked.

**Staying unjudged on purpose:** values the compiler can't know, such as Anything slots, types the file knows nothing about, and classes with as clauses that may convert. Those belong to the runtime ticket for as.

**To decide:** For an overloaded function, must the annotation hold for the overload selected by the arguments, or for all overloads when the selection can't be determined?

**Done when:** Each case above gives a compile error when the annotation is provably wrong and compiles when it holds, with no new false errors in existing code.

**What** **exists.** checkAnnotationCovers (src/validate.js:3272) is called from one site (validate.js:2966), only when the value is a direct call:

- to a local function with exactly one definition, judged across all of its return paths (returnShapes); or
- to a member of a dependency whose doc has exactly one signature (remoteReturnShapes).

A slot type is judged only if it's a scalar or a local class without as clauses (canJudge). The baseline works: f = { return "a" } followed by x Integer = f() errors as it should.

**Case** **1:** **x** **Integer** **=** **y.**

- Unjudged for a typed local, a param, a state var, an inferred literal local, and even a literal: x Integer = "a" compiles.
- The types are already in typeEnv (buildTypeEnv, plus the file's state types), so the check would just compare typeEnv.get(y) against the annotation.
- **Risk:** there's no flow narrowing. isAssignable treats a union source as never fitting a single type ("can't narrow without a guard"). So with y Integer | null, x Integer = y would error even inside if y != null { … }. That would be the main source of false errors.
- Either judge a union source only when no member could fit, or treat union sources as unjudged until narrowing exists.

**Case** **2:** **x** **Integer** **=** **f()** **+** **1.**

- Unjudged because inferExprType has no rule for a FunctionCallExpr (src/inference.js), so any expression containing a call infers as unknown.
- The binary-operator rules exist (numeric promotion, Text + Text, List + List, comparisons give Boolean).
- The fix is an expression typer for the check that types a call as the union of its positional return slots (returnShapes), then applies those rules. A mixed pair like Text + Integer infers as unknown and stays unjudged.

**Case** **3:** **overloads.**

- Unjudged because the call site requires a single definition (fns.length === 1); the overload path computes only a shape for the named-field checks.
- Selection pieces exist: clauseAccepts (validate.js:2628) filters clauses by arity and names, and checkClauseTypes does per-argument isAssignable.

**Case** **4:** **t** **=** **Thing() then** **t.nope().**

- The gap is narrower than the ticket says: only a local inside a handler is affected. At file level, t = Thing() is typed as Thing (stateTypeEnv, validate.js:2006), so t.nope() errors ("'Thing' has no function 'nope'"), and the annotation check works on x Text = t.get().
- buildTypeEnv (validate.js:2376) types an untyped local only from a literal. Giving it the same "constructed from a dependency" rule as stateTypeEnv would close the member check and the annotation check for t.get() with one change.
- **Side** **finding:** t Thing = Thing() errors with "No matching 'self-as' clause in service 'Thing' for type 'Thing'". The dependency typed-assign check (validate.js:2985) doesn't accept the dependency's own class as the type. That looks like a bug. It belongs with the member-check split.

**On** **the** **"to** **decide"** **question,** my recommendation: the annotation must hold for every overload the arguments could select.

- Overloads match in order at run time, so if the argument types are all known and the first accepting clause certainly accepts, only that clause counts.
- Otherwise the candidates are the clauses not ruled out by arity or argument types, and the annotation must hold for each of them.
- That reduces to "the selected overload" whenever the selection is determinable, and stays sound when it isn't, without guessing.

**Suggested** **order:** case 4 first (one buildTypeEnv change, and it fixes the annotation check too), then overloads, then expressions, then plain names. Plain names go last because they need the decision on union sources and narrowing first; that's the one place "no new false errors" is at real risk.
