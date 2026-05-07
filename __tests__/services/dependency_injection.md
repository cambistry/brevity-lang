# File-Level Dependency Injection

LLM orientation: use this as the current source of truth for file-level
dependencies. Prefer explicit inline constraints in examples.

## Canonical Form

```brevity
*(
  "/services/db": (DB) {
    lookup: (:key Text) -> (:value Text)
  }
)
=

@query
  =
  :key Text
  =
  :value Text = DB.lookup(:key)
  -> :value
```

Meaning:

- `"/services/db"` is the dependency path.
- `(DB)` is the local alias used in source.
- The block is the required service interface.
- `DB.lookup(:key)` emits a CAM message to `DB` with op `@lookup`.

## Tested Behavior

- Single and multiple dependency entries compile.
- Comma-separated dependency entries compile.
- Bare dependency declarations parse, but `compile()` rejects them unless the
  host supplies an interface through `options.remotes`.
- Silent calls emit outgoing messages and do not wait for a value.
- Replying calls store a continuation and resume when the remote reply arrives.
- Service aliases can be cast with `as { @method: (...) -> (...) }`.
- Inline constraints reject undefined methods and type mismatches.

## Bare Dependency Form

This parses:

```brevity
*(
  "Remote": (Remote)
)
=
```

But compilation needs a remote interface:

```js
compile(ast, {
  remotes: [{ path: 'Remote', service: remoteInterface }]
})
```

For generated examples, prefer inline constraints unless the point is testing
`extract()` / remote interface resolution.

## LLM Rules

- Use `*( ... ) =` at file top for dependencies.
- Use `(:name Type)` in service signatures for named args.
- Use `-> .` for silent service methods.
- Do not claim dependency discovery is automatic inside this repository; the
  host must provide unresolved remote interfaces.
