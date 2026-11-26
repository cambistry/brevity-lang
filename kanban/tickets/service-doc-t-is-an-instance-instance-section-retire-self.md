---
status: queued
created: 2026-11-23
---
# Service doc: `":T"` is an instance; `instance` section; retire `%self`

- The compiler's internal form stops spelling a class value as `':T'` (opre_types.js:60 asClass): a class value's type is `*`; which class it is comes from its binding, not its type.
- `":T:*"` → `":T"` in every type position; `$new`'s `re` is `":T"`.
- The `":*"` node key becomes an `instance` section beside `public` (service_doc.js:123, 218-228, 394, 412).
- `{ "%self": true }` retired: `=> self` on an instance is `":T"`; remove SELF / isSelf (opre_types.js:33, type_enc.js:24, service_doc.js:299, type_names.js:105) and the `%self` entries in browser/dom_documents.js, typed as their element's class.
- The compiler's internal form stops spelling a class value as `':T'` (opre_types.js:60 asClass): a declared actor's type is `*`, a class's included; which actor it is comes from its binding, not its type.

**Status of `%self` (2026-11-26):** retired in design (notes/class-of-and-self-return-2026-11-23.md),
still in code: `SELF` (opre_types.js), `isSelf` (service_doc.js), `SELF_KEY` (type_enc.js), the DOM
documents, and tests in bang, layers_remote and extend_remote expect it. This ticket removes it.
The first and last bullets are the same point.
