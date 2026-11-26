---
created: 2026-10-31
---
# Optional parens on all zero-arity calls

`actor.fn`

`actor.mutate!.value`

`actor.mutate!…`

`actor.silent…`

Note: `actor.silent.` is not a valid call form, since it fails to document f-a-f. And four-dot ellipsis is illegal. `actor.silent….` X

In particular, `actor.silent.()…` is fugly. Should perhaps be illegal.

Open question: how should a silent function with args be called?

`actor.silent.(args)…` is also ugly, and that dot seems unnecessary, since a trailing ellipsis after a read-only function is illegal, so this can be inferred to be silent. Better form: `actor.silent(args)…` ?

A regular mutation function would keep the bang attached to the name:

`actor.mutate!(params)…`
