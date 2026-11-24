---
status: done
created: 2026-11-18
---
# Type tags name a dependency by its source only

Summary

A tag reached through a dependency is spelled with the dependency's source, `svc.bv:Point`, never its local alias (`Svc:Point`). The type registries still also accept the alias spelling: src/codegen/type_table.js `registryEntries` (lines ~43–60) adds `Svc:Point` next to `svc.bv:Point`, for "a parent names a service by the alias its child gave it." Since dependencies are addressed by source, no parent names a service by its alias, so that spelling no longer arises from anything we emit.

Semantics

- Tags are `source:Type` (Opre-quoted where needed, `'a:b.bv':Point`), or relative (`:Point`) inside the file that declares the type.
- An alias-spelled tag (`Svc:Point`) from outside is unknown: the same error as any unknown tag.
- The local alias stays a source-level name: `Svc::Point` in annotations is unchanged.

Work

- Drop the alias spellings from registryEntries and its consumers: JS `_bv_types` (classes.js) and `_matchTypes` / `_bv_type_keys` (preambles.js), rust program.js `registryEntries`, erlang program.js `registryEntries` / `bv_source_key` and preambles.js.
- Check what else emits a tag from a local name. For example, a cell holding an actor of a dependency's class is tagged with the alias (`~t` → `"Thing"`); it should be the source's tag.
- Tests: mocks that send alias-spelled tags (`'ty': 'Svc:Counter'`, `'Svc'`, `'Thing'`, `'GT'` …) move to source tags; add an unknown-tag case for an alias spelling; check the routers in classes/public_class_across_files that promote tags.
