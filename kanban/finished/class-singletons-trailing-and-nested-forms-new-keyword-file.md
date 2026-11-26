---
created: 2026-11-13
---
# Class singletons: trailing and nested forms, `new` keyword, file `*` section

Design: notes/class-singleton-forms-2026-11-13.md (background: classes-as-singletons-2026-11-09.md, file-singleton-header-2026-11-13.md)

Make `new` a reserved keyword

- Add `new` to KEYWORDS in src/lexer.js: bare in source, `$new` on the wire.
- Inside a singleton, `new = (params) *{ … }` makes the singleton a class. A local `C()` is `new` sent to `C`.

Nested form (delimited and lineal)

- `C = **{ members … new = (params) *{ ctor } }`
- The constructor block closes over the singleton: it sees all members, private cells included.
- Lineal: `C = **` then members, with `new =` followed by `*` params `*` and the body. A blank line ends the whole singleton, so members after it are not part of `C`.

Trailing form (delimited only)

- `C = (params) *{ ctor } **{ members }`
- This is NOT sugar for the nested form. The constructor's lexical chain skips the class singleton and goes to the enclosing actor. It reaches the class only through its published interface (`C.count`, `C.bump()`).
- In both forms, an instance's address is `C n` under `C`, and its `ty` names `C`. Set the lexical environment and the owner/address separately.
- Writes and calls from the instance to `C` are ordinary messages. The rule that refuses writes and calls to an enclosing actor does not apply.
- Errors:
- the leading form `**{ } (params) *{ }`
- the lineal trailing form (`*` params `*` ctor, then `**`)

File layout: `**` header, members, then a `*` section

- A `*` section after a `**` header (or after a `**`-headed body) is the file's `new`. It is the nested form, so it closes over the file's members.
- The `*` section is the last section of the [file: everythin](file: everythi "")g below it is constructor body.
- A file with only a `*` header stays a factory whose class has only `new`. A file with a `**` header or no header stays a singleton.
- Set `ast.fileKind` for the new layout (proposal: 'class').

Ordering check

- Compile error when a class block calls `new` / `C()` before a member the constructor reads is initialized. Otherwise the two wait on each other at load. Applies to both forms.

Service document

- A class with class members renders those members alongside `C (…) -> *{ … }`. Round-trip it through parseInterface.

Decide before starting

- Nested form: may an instance write to or call its own class (`count <- count + 1`)? The nested-actor rule refuses this today. The note leans toward exempting the instance's link to its own class. Without the exemption, the nested form can only read.

Out of scope

- A source spelling for "my class" (the trailing form goes through the name `C`).
- The lineal trailing form.

Tests (one shared script per describe; run per file)

- Nested: the ctor reads a private class cell; delimited and lineal; a blank line ends `C` in lineal.
- Trailing: the ctor reads `@count` via `C.count`; a bare `count` in the ctor fails to resolve.
- Address and `ty` of an instance are `C n` and `C` in both forms.
- [File: ]( "")a `**` header, members, then a `*` section; the instance sees file members; the `*` section runs to EOF.
- Errors: the leading form, the lineal trailing form, the ordering deadlock.
- `new` as a keyword: `new` can't be used as an ordinary member name.
