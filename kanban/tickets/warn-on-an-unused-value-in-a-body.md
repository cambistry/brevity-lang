---
created: 2026-11-26
---
# Warn on an unused value in a body

Today: an expression statement whose value nothing uses compiles silently, in a function body (`@f = () { "hi"\n 2 }`) and, once `retire-constructor-return-as-findings` lands, at the end of a constructor block (`C = *{ … "hello" }`).

Want: a value with no effect that nothing uses (a literal, a lone name, a `( … )` or `[ … ]`, a lambda) is a suspicious unused value. It warns rather than fails, since a call in the same position may be run for its effect.

Depends on `add-a-compiler-warning-channel-and-the-warnings-waiting-on`.

Decide: which expressions count as effect-free; whether a function body's last expression (its implicit reply) is ever unused.
