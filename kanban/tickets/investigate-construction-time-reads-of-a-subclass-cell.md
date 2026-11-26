---
status: investigation
created: 2026-11-20
---
# Investigate: construction-time reads of a subclass cell through a late-bound override

Design context: notes/super-2026-11-19.md ("In a constructor, `super` builds the base"), notes/forward-reads-in-constructor-blocks-2026-11-11.md.

Question: can a parent's constructor body, run at a subclass's `super` line, reach a subclass cell before that cell's line via a late-bound override? This is Scala's and Kotlin's initialization trap.

```
T = *{
  got Integer = probe()
  probe = -> 0
}
U = T ^ (k Integer) *{
  super()
  marker Integer = k      // declared after super
  probe = -> marker       // T's body calls this at the super line
}
```

Today: the read-before-`super` check covers base names read directly above the line. init_order.js checks a block's own forward reads, through calls. Neither sees the path parent body → subclass override → subclass cell below `super`, because the parent's body is spliced in at codegen (expandSuperInits, src/super_calls.js).

Today (confirmed 2026-11-26 on js and erlang, the direct case without an override function):

```
Base = *{
  label Text = "base"
  size Integer = Text.size(label)
  @size = -> size
}
Sub = Base ^ *{
  label = "hello!"
  super()
}
```

- `label` above `super()`: `Sub().size()` replies 6.
- `label` below `super()`, or with no explicit `super`: the call replies `ex: {go: "error"}` at runtime, with no compile error.

This is the replacement for `ingest` (`notes/constructor-tail-and-ingest-retired-2026-11-26.md`), so the rule decides how that pattern fails when it's written wrong.

- Write the test above, on every target. Report what each does: a compile error, a null, a hang, a crash.
- If it compiles, decide the rule. Proposed: a construction-time path that can reach a cell before its line is a compile error, followed through calls and overrides, the parent's body included.
- Related, to state in the note either way: the constructor block is a declaration. Its interface (functions and clauses) is static; its cells are initialized in text order; `super` is where the parent's initializers run.
- Also check multi-parent ordering (`super[A]` / `super[B]` at different lines) for the same hazard.
