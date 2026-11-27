---
created: 2026-11-26
---
# Double check for dead code paths with removal of ingest / constructor return

**Checked (2026-11-26):**

- No source form or consumer of `declarationReturn`, `__returnAs`, `IngestExpr`, `inheritedIngests`, `ingest`, `_tail`, `inlineExpandable`, memoized `$as` arms or `hasReturnAs` remains, on any target or in the browser runtime.
- No helper became unused with the removal. Helpers with no caller today (`bv_dec_ensure` and `bv_dec_to_number`, `decZero`, `isTerminatingReciprocal`, `ensureValue`, `enclosesClasses`, `expectedTag`, `typeNamesIn`, `erlangRuntime`) lost their callers in earlier, unrelated work (Decimal arithmetic, type encoding).
- A constructor block's `ImplicitReturn`, valued `Return` and `self` tail have no handlers left; the remaining `self` returns are function bodies'. Bare `()` and the file opener's `return` are still reachable forms.
- A stale header comment in `__tests__/syntax/star.test.js` named the retired ingest form; it now lists the current subclass forms.
