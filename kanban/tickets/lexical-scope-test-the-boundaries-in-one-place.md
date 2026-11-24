---
status: done
created: 2026-11-19
---
# Lexical scope: test the boundaries in one place

Rule (notes/private-names-lexical-2026-11-16.md, notes/class-scope-and-inheritance-2026-11-16.md): an inner scope reaches every name of the scopes lexically containing it. Some code isn't lexically inside, and must say so. __tests__/classes/lexical_scope.test.js covers what reaches; of the boundaries it has only "a private name is never reached through an address" (`x.#y`).

Investigate, then fill in

- Which boundary errors exist today, and where they're tested (class_scope.test.js, outer_reads.test.js, class_qualified.test.js):
- a trailing or `++`-composed constructor naming its class block's members bare (only `class.` / `class::` reach them);
- a subclass naming its parent's private (`#x`) names;
- a private name through an address: `class::#y` as well as `x.#y`;
- shadowing: a class's own name wins over an outer one; a function's params may reuse an outer name; the no-shadowing errors where shadowing isn't allowed (a `use` name, a local in the same scope).
- For each: does the error say which boundary it is? Is it on all of js, rust and erlang (a compile error is target-independent, but check any that are runtime)?
- Any boundary with no error at all (silently resolves to something else) is a bug: fix it.

Done when lexical_scope.test.js has a "boundaries" describe asserting each error's message (or pointing to the existing test by name), and every boundary has an error.
