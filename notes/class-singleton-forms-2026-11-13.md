# Class singleton forms: trailing vs nested — 2026-11-13

Follows `classes-as-singletons-2026-11-09.md` and `file-singleton-header-2026-11-13.md`.

**2026-11-17:** the braced `**{ … }` is now the actor literal `actor { … }`; see `actor-literal-2026-11-17.md`. The trailing form takes `++`.

**2026-11-17 (later):** the file-level `*` section after singleton lines ("Files: `**` header, then a `*` section") is retired: a file declares `new =` instead. A `*` at the head of a file still makes a factory. See `use-di-2026-11-17.md` ("Factory files and the trailing `*` section").

## Two forms, two meanings

```brevity
// Trailing: instances are clients of the class
C = (seed Integer) *{ C.count } ++ actor {
  count *Integer = 0
  @count = -> count
}

// Nested: instances are part of the class
C = actor {
  count *Integer = 0
  new = (seed Integer) *{
    count <- count + 1
    puts count
  }
}
```

- **Trailing is not sugar for nested.** The constructor isn't textually inside the class block,
  so it doesn't close over it. It reaches the class through the class's published interface
  (`C.count`), the same as any other client. The class's private state stays private, even from
  its own instances.
- **Nested closes over the class.** `new`'s constructor block is inside the singleton, so it
  sees every member, private cells included.
- **Superseded in part (2026-11-16):** with `++` composition (`actor { } ++ (params) *{ }`), order
  sets override precedence, never visibility, so the leading order becomes a valid
  arrangement. Juxtaposition without `++` is still not a class. See
  `class-scope-and-inheritance-2026-11-16.md`.
- **The leading form (`actor { } (params) *{ }`) is not supported.** It looks like a call on the
  singleton, and if order changed what an instance can see, it would be a third set of rules.
- `C = (params) *{ }` is unchanged: a class with no class block.

## Lexical scope vs address

Lexical scope follows the braces. Address and `ty` follow the class. In both forms an instance is
`C 1` on the wire, under `C`'s address, with `ty` naming `C`. In the trailing form the
constructor's lexical chain skips the singleton (it goes to the enclosing actor, where `C` is a
name), while its owner is `C`. The implementation has to keep the two apart: the code that sets
the lexical environment is not the code that sets the owner.

## The class's members from outside and from its actors

**Superseded in part by `class-scope-and-inheritance-2026-11-16.md`:** protected members are
reached through `::`, not a dot (`C::count`, `class::count`). The dot takes public names only.
Writes and calls through `::` are covered as well as reads.

- **Public members are messageable.** A public class's public members answer at the class's own
  address: `count` to `. C`. `$new` to `. C` still builds a `C`, and `C 1` is still its first actor.
- **Protected members, from the class's actors.** A bare member is protected (`~count` on the
  wire): readable inside the class and its subclasses, not by a client. In the trailing form the
  constructor isn't inside the members, but its actors are inside the class, so `C.count` on a
  protected `count` is a read they may make, by message. Direct access to the binding (a bare
  `count`) is a matter of closure structure, so it stays with the nested form. Reading only:
  writing a protected member through `C.` isn't covered.

## Writes and calls to the class

- **Trailing:** `C.count`, or a call to a published `@bump`, is a message to another actor. The
  rule that refuses writes and calls to an enclosing actor doesn't apply.
- **Nested:** `count <- count + 1` is a write to the enclosing actor. **Decided:** no exemption is
  needed, because the rule doesn't differ from a closure's. A closure sends to a cell of its
  enclosing scope; a class sends to a cell of an actor it's declared in. The refusal of writes and
  calls to an enclosing actor was a gap in the implementation, not a rule, and it's gone for every
  nested class: a write is a `$set` to the owner's cell (only a `*` cell can be set), a call is a
  message to the owner, and both are delivered as a read is, so a class reads its own writes.

## Ordering

Ordering doesn't change what an instance can see. It matters inside the class block, through the
forward-reads rule (text order; an actor's own read before its init is a compile error; other
actors' reads wait):

```brevity
C = actor {
  origin = new(0)
  count *Integer = 0
  new = (seed Integer) *{ n = count + seed }
}
```

The instance's read of `count` waits on `C`, and `C` is waiting for `new(0)` to reply, so the two
block each other. It is all one declaration, so it can be a compile error: the class calls `new`
(or `C()`) before a member the constructor reads is initialized. The trailing form can hit the
same thing (`origin = C()` in its `actor { }`), and its instance reads are messages, but it's still
one declaration and still detectable.

## Lineal: nested only (for now)

Delimited supports both forms. Lineal supports only the nested form.

```
C = **
  count *Integer = 0
  new =
    *
      seed Integer
    *
    count <- count + 1
```

- A lineal block ends at a blank line, so the blank line that would end `new`'s body also ends
  `C`. Members after it fall out of the class. Use `--` for visual space, put `new` last, or use
  the delimited form.
- **Not supported:** the lineal trailing form (`*` params `*` constructor, then `**` members). If
  it comes back: an inline singleton takes no DI, so its part is `**` alone followed by members,
  never a `** … **` pair, and it must directly follow the constructor (no blank line), since a
  `**` after a blank line would be an unnamed inline singleton.

## Files: `**` header, then a `*` section

Settles the "two-section layout" left open in `file-singleton-header-2026-11-13.md`:

```
**
  DI
**
count *Integer = 0
@total = -> count

*
  seed Integer
*
count <- count + 1
```

- Everything after a `**` file header is the file singleton's body, so a later `*` section is
  inside it. It is the file's `new`, the nested form without `new =` written out, and closes over
  the file's members.
- The `*` section is the last section of the file: everything below it is constructor body.
  Class functions go above it.
- A trailing layout (`*` params, constructor, then `** DI **`) is out for files: the DI header must
  open the file.
- **On the wire:** `$new` to the file builds one. Its address is `n` under the file (`#<. 1>`), and
  its `ty` is `.`, the file's own class, as for any class: `C n` under `C`, of class `C`.
- Unchanged: a `*` header with no `**` above it is a factory whose class has only `new`. A `**`
  header or no header is a singleton.

| Where       | Form                                          | Constructor sees                 |
|-------------|-----------------------------------------------|----------------------------------|
| Inline      | `(params) *{ } ++ actor { }` (delimited only) | the class's interface: `C.count` |
| Inline      | `C = actor { … new = (params) *{ } }`         | the closure                      |
| File        | `** DI **` members, then a `*` section        | the closure (the file's `new`)   |

## `new`

`new` becomes a reserved keyword (per the 11-09 note): bare in source, `$new` on the wire. In a
singleton, `new = (params) *{ … }` makes it a class.

## Open

- ~~**"My class" in source.**~~ Decided: `class`, shorthand for `self::class` (`class_of` is
  retired). See `class-scope-and-inheritance-2026-11-16.md`.

- **"My class" in source.** In the trailing form `C.count` goes through the name `C` in the
  enclosing actor. That breaks if the class is unnamed, renamed or private, and reads oddly when a
  class refers to itself. The wire has a token for it (`ty`); source may need a spelling too.
