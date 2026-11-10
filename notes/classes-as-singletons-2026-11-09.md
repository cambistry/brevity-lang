# Classes as singletons; `**` file headers — 2026-11-09

Design discussion, not implemented. Starts from "is `C()` shorthand for `C.#new`?" and ends at a
change to the standard file header.

## `C()` is `#new`

A class's constructor is what answers `#new`. `C()` is essentially `#new` sent to `C`.

What the three spellings compile to today (JS target):

| Source     | Compiles to                                                |
|------------|------------------------------------------------------------|
| `C()`      | in-process `C.create(…)`; a local `C()` sends no `#new`     |
| `C.new()`  | a send of `@new`: an ordinary public member, not `#new`    |
| `C.#new()` | `this.#b_zz = C.;`: invalid JS. **Bug:** should be a compile error |

So `C.new()` names a different function living under `C`. That raises the question of how to
define class-level functions at all.

## Class-level members

Without class identity, "class" is a shaky term. Class identity already exists on the wire (`C`
has an address, receives `#new`, `ty` names it), but there is nowhere to declare its other
members. Options considered:

1. **Dotted definition:** `C.count = -> count`, with state in the file. Mirrors the call site, but
   scatters members across the file and puts the state in the enclosing actor, not in `C`.
2. **A class block of members, with the constructor as a member.** Natural, but on its own it
   breaks the file-oriented design: a file *is* a new function and has nowhere to put a
   class block.
3. **The enclosing actor as the class space.** No syntax, but no class identity: the hole, renamed.

A breakout from *inside* the constructor was rejected: class code would sit where instance
params are lexically visible but meaningless.

Settled on a **separate trailing block**:

```brevity
C = (seed Integer) *{ count <- count + 1 } **{
  count *Integer = 0
  @count = -> count
}
```

- The class block can't see instance params; instances see the class block through their chain.
- `} {` (and `} **{`) is free syntax: braced bodies already forbid anything after `}`.

## `**{ }`: define and instantiate (singleton)

The class block doesn't just define an actor. It defines it *and creates it* when its enclosing
actor is constructed, so a bare `{ }` undersells it. `**{ … }` says "define and instantiate," set
against `*{ … }`, which is run once per new actor.

- **General, not class-only:** `cache = **{ … }` declares an inline singleton anywhere.
- **No params on an inline singleton:** `s = (params) **{ … }` would be told to build now with
  nobody to pass it anything. It closes over its enclosing actors instead.

## Core form: a class is a singleton that answers `new`

```brevity
C = **{
  count *Integer = 0
  @count = -> count
  new = (seed Integer) *{ count <- count + 1 }
}
```

- `C = (seed Integer) *{ … } **{ … }` is sugar for this.
- `C = (seed Integer) *{ … }` is sugar for a singleton whose only member is `new`.
- Overloaded constructors use the overload model; other factory members (`@from_text`) sit beside
  `new`.
- **`new` becomes a reserved keyword.** It isn't one today. This follows the precedent of `set` /
  `subscribe`: an intrinsic op gets a bare keyword in source and a `#` name on the wire (`#new`,
  `#set`). That keeps `#` unambiguous: private in source, intrinsic on the wire. Spelling it
  `#new` in source was rejected, because a private-looking label would have to be callable from
  outside.

## Files: the header declares the file's kind

A file has a builder (its host), so a file-level singleton *does* get params: the header is its
DI, filled in once at load. This is the only level where a singleton takes arguments.

New standard file format:

```
**
  DI
**
body
```

- **`**` header:** "I am not a factory." A singleton, built once at load. This is the default and
  the common case.
- **`*` header:** a factory. The body is `new`'s constructor block. **A `*` header gets no DI.**
  DI is the host providing "who can I talk to" to something it builds at load, which is a
  singleton. A factory's instances are built by whoever calls `new`, and that caller supplies
  everything through params, actors included. So a `*` header holds params only; a factory reaches
  services through its params or through an enclosing singleton.
- **The importer's notation becomes a check.** Until now the importer decided
  inject-an-actor vs get-something-to-construct (`"path.bv": Alias` vs
  `"path.bv": Alias (ctor) -> *{ … }`), and the file had nothing to say about it. Now the file's
  doc carries its kind, and a mismatch is a compile error at the import site.
- **`**` is preferred as the default sigil:** more distinct as a line on its own, and the extra
  character carries meaning, not window dressing.

## Exponent moves to `^`

`**` is the power operator today (`POWER` token), so `} **{` lexes as an exponent, and a lone
`**` line would too. `^` is entirely free: no token, no rule, no meaning in the docs or notes.

- Precedent: exponent in Lua, R, Haskell, Excel. XOR elsewhere; a future bitwise XOR would take a
  name (`bxor`).
- Right-associative, like `**` now.
- Migration: Brevity sources in `__tests__/core_types/` (Integer, Decimal, Float). Codegen maps the
  operator, so the targets don't change.

## Open

- **A factory file with class-level state** takes both sections: a `**` header (the singleton's
  DI, from the host at load), then a `*` header (`new`'s params, per instance). Settled by the
  no-DI-in-`*` rule; the alternative (one header, with DI entries going to the singleton and
  params to `new`) is out. The exact layout of the two sections is still open. Today the one
  header does both jobs (DI entries plus the file actor's `initParams`).
- **Migration:** most existing files are singletons in practice but use a `*` header, so they
  become `**`. Mechanical, but touches nearly every file and test source.
- **Headerless files:** default to singleton.
- **A local `C()` skips `#new`** (in-process creation). Anything meant to ride on the `#new`
  envelope (e.g. `ctor`) must also be applied on the local path.

## Implementation touch points

- `KEYWORDS` in `src/lexer.js`: add `new`.
- `POWER` lexing: `**` → `^`.
- `hasHeader` in `src/codegen/browser/runtime.js` matches a lone `*` line; it needs to learn `**`.
- `documentDI` (implicit DI for inline `<head>` scripts) prepends a `*` header; it becomes `**`.
