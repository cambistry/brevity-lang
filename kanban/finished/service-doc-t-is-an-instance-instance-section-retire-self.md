---
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

**Decided (2026-11-26):** a self-returning op's `re` in the document is `":*"`, self's class, as
on the wire (`re: ['#<:>']`, `ty: [':*']`). It types the result as the receiver's class wherever
the op is called, inherited ops included (`el.normalize!()` is an Element). It replaces
`{ "%self": true }` everywhere, the DOM documents included. No remote op chaining here.

**Decided (2026-11-26): `:T` is an instance's type everywhere,** the compiler's internal form
included: no `:T:*` anywhere. `:T:*` was the document's node path for the instance interface,
which is now the class's `instance` section. Whether `:X` is an instance's type or a declared
type is what `X` is (a class or a type), not its spelling. A file that declares `new` answers
`$new` with `":"`, as `ty: [':']` on the wire.
