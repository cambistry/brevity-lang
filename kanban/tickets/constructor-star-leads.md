---
created: 2026-11-25
---
# The constructor star should lead: `*(params) { body }`

Design: `notes/constructor-star-prefix-2026-11-25.md`.

Want:

- `C = *(seed Integer) { … }` is the constructor form, with an optional arrow (`*(p) -> { … }`). `C = *{ … }` and the `^` layers (`T ^ *(n) { … }`) follow.
- `*(p) { … }` is sugar for `(p) -> actor { … }`, a constructor: a function that builds and returns a new actor each call. Bound to a name it names a class, as an actor's `new` it attaches to that actor, and as a `^` layer it composes (`C = actor { … } ^ (p) -> actor { … }`). Both forms type and document the same.
- The constructor profile is `*(…) -> { … }`, in source types, `use` entries and service documents.
- The lineal header (`*`, params, `*`) is unchanged.

The spelled-out form needs an actor literal as a value (after `->`, returned from a body) that closes over the call's params.

Today: both `(p) -> actor { … }` and `(p) { actor { … } }` are parse errors.

Open (in the note): the file header, a body returning a literal on only some paths, overload clauses.

**Decided (2026-11-26):**

- **This ticket is the lead star:** `*(p) { … }`, `*(p) -> { … }`, `*{ … }`, the `^` layers (`T ^ *(n) { … }`), overload clauses (`C << *(p) { … }`), and the type profile `*(…) -> { … }` in source types, `use` entries and service documents.
- **The old forms go** (`(p) *{ … }`, `(p) -> *{ … }`, the type `(…) -> *{ … }`), failing as ordinary parse errors.
- **The file header leads with its star too:** `*( deps ) { … }`, as the lineal header does. `( entries ) actor { … }` stays.
- **Constructor overload clauses lead with the star too:** `C << *(p) { … }`.
- **The spelled-out form** `(p) -> actor { … }` is `spelled-out-constructor-returns-an-actor-literal`.
- **Migration:** a mechanical rewrite moving the star before the params, across tests, docs, `.bv` files and Brevity in `src`; `notes/` stays as history.
