# Every class has a class block, implicitly empty — 2026-11-21

Decided in discussion. Supersedes the delegated rule of
`class-scope-and-inheritance-2026-11-16.md` for a subclass with no class block of its own
("uses its nearest parent's"), and makes concrete `opre-extend-and-as-2026-11-20.md`'s "A
subclass's class block always has a base".

## The rule

`C = () *{ … }` implicitly makes an empty class singleton, as if it wrote `^ { }`. A class
with no class block of its own has one, with no names.

- **A subclass's implicit block extends its parent's** (the nearest written one up its
  chain), by delegation, as a written block does: it sends `$extend` there, a call for a name
  it inherits is a delegated call (`as`), and a cell it inherits is the parent block's one
  cell, read and written there.

  ```brevity
  C = (n Integer) *{ … } ^ {
    total *Integer = 3
    @all = -> total * 10
  }
  D = C ^ (k Integer) *{ super(k) }   // D's block is `^ { }`, its base C's block

  D.all()                              // C's `all`, run for D's block: 30
  ```

- **The same model local or remote.** A parent's block in another file can't be shared as a
  child's own, so it never was a choice there; now a parent here is the same. The child's
  block is its own actor at the child's label; its `$extend` to the parent's block speaks for
  the class, carrying the `instance` section, so there is no separate class handshake to a
  parent with a block.
- **Notional when there's no base.** A class whose parents have no class block (or that has
  no parent) has an empty block with nothing to extend or delegate to: no actor, as the note's
  empty base.
- **Transparent between two others.** In `W ^ V ^ T` with only `T` and `W` writing blocks,
  `W`'s block extends `T`'s, not `V`'s implicit one: an implicit block is never a base. `V`'s
  extends `T`'s as well.
- **Scope is unchanged.** A subclass's constructor and functions don't close over a class
  block, its implicit one's base included: `count` in `D`'s functions is the same error it
  was ("'count' is a member of the class 'C', and a subclass of 'C' doesn't close over its
  class block").
