---
status: todo
created: 2026-11-23
---
# Self-return tags `:*`; hosts reduce `X:*`

Per notes/class-of-and-self-return-2026-11-23.md. Depends on "The class answers `$new`".

- An instance built by `new` self-returns `{ re: ['#<:>'], ty: [':*'] }`. Its host translates `:*` to `<addr>:*` and, knowing the class, reduces it to the class's address (`:Box`). A host that doesn't know passes it on, translated.
- A declared actor knows its class is `*` and sends `ty: ['*']` itself (the emitter's declaredActor branch, classes.js:1712, stays as that).
- Remove the bare-`:` special case in `localTy` (classes.js:1497, `if (v === ':') return tag`) and the `':'` branch at 1712. `:` in `ty` is an address like any other. Same in rust/erlang.
- Wire tests: a self-return from an instance, a declared actor, and an instance of a class in another file, each seen from outside.
