# There are no classes, only actors — 2026-11-18

Decided in discussion. Supersedes the "class as a value" section of
`class-scope-and-inheritance-2026-11-16.md` and qualifies `vocabulary-refactor-2026-05-15.md`,
where "class" is a noun.

## The rule

There are actors. A "class" isn't a kind of thing. It's a relationship an actor has with its
`new` function: an actor with a `new` builds actors, and the actors it builds are "of" it.

- `Box = (seed Integer) *{ … }` declares an actor, `Box`, whose `new` builds others. `Box` is at
  `:Box` and answers `$new` there, and its class block's members live there.
- A singleton with `new =` is the same: an actor with a `new`.
- An actor without a `new` is an actor. Asking it to build something is an unhandled message.

## Consequences

- **Actors are values, any actor.** `k = Box`, `k = s` (a singleton), `k = b` (one `Box` built)
  and `Self` all pass an actor's address. There is no separate "class value".
- **`k(args)` is `$new` to the actor `k` holds**, however `k` was bound: statically, as a
  param, returned from a call, or in a cell. Binding a name to a declared actor and resolving
  `k(args)` at compile time is an optimization, not the meaning.
- **`k.x` is a message to that actor**, as for any actor reference.
- **`::` stays static.** `C::x` is the protected relationship of a family, decided from the
  text. It resolves for a name that's statically bound to a declared actor (`k = C; k::x` is
  `C::x`, family-checked against `C`). On an actor that arrives at runtime it's an error, since
  there's no family to check.
- **The type of an actor with a `new` is its constructor profile**, `(…) -> *{ … }`, the same
  claim `use` takes: `k (seed Integer) -> *{ get () -> (Integer) }`. An interface (`*{ … }` /
  `{ … }`) types any actor with those members.
- **`Class` is gone, as a type and as a tag.** Where Brevity needs a name for "an actor, any
  actor", it's `Actor` (`k Actor`); on the wire that's `*`. `Actor` takes built and declared
  actors alike; `k Box` still takes only actors `Box` built.

## On the wire

An actor reference is its address, array-wrapped like every reply value
(`{ re: ['#<…>'], ty: [ … ] }`). `ty` carries what the value doesn't already say:

- **An actor a `new` built** is tagged with the address of the actor whose `new` built it, as
  now: `{ re: ['#<:Box:1>'], ty: [':Box'] }`, `ty: ['svc.bv:Counter']`. Its own address doesn't
  say what it answers; its maker does, and a typed param (`x Box`) checks it.
- **An actor no `new` built** (a declared actor: `Box` itself, a singleton, the file actor) is
  tagged `*`, the Opre universal for "an actor": `{ re: ['#<:Box>'], ty: ['*'] }`. Its
  interface is where its address is: the service document represents it there. So `Box` is
  never mistaken for one of its own (`x Box` takes `:Box`-tagged actors, not `*`).

A declared actor addressed from somewhere else is written by its absolute address
(`#<c.bv:Box>`) when the relative one can't be said from where the code runs (an instance can't
name its file actor relatively). That needs the file's name, as `Self` as a value does today.

## Vocabulary

"Class" survives only for membership through `$new`: the actors `Box`'s `new` built are of
class `Box`, and `x Box` checks that. Everything else says actor: `Box` is an actor with a `new`
(not "a class"), its block is the actor's block, a singleton is an actor, and the file is an
actor. Docs move to this wording as they're touched.

## What this replaces

- Ticket 4's `Class` type and `ty: 'Class'` (and `Self`'s `ty: 'Class'`) become `Actor` / `*`.
- The `ClassValue` lowering and its slot list give way to: any expression naming an actor is
  its address, made in each target's expression codegen.
- The gaps listed for class values (`Class` params, cells, protected classes going out) are
  ordinary actor-reference questions now. A protected actor (`C`, `s`) going out is the
  protected-classes follow-up, generalized to any protected actor.
- The `$new`-reply ticket (array-wrapped address replies) tags with the rule above.

## Details settled in implementing it

- **A held address under the holder is the holder's to deliver.** An actor holding `#<:x>`
  (one it declares, or one it built) delivers a message to it itself, `to` and all, as the
  wire's would be; any other address is sent out. A private declared actor (`#<:~s>`) is
  reached this way by its holder's own sends only: it isn't published on the wire (that's
  the protected-actors follow-up).
- **A param's type checks the arg's tag.** `x Box` expects `:Box`, the maker's address. `x
  Actor` and a constructor profile expect any actor: `*`, or a maker's address (a tag with a
  `:` or a `.` that isn't a type's).
- **`k = C` with `k Box` is an error** naming `Actor`: `'k Box' takes an actor 'Box' built`.
- **A singleton's self-return is tagged `*`**, as its value is: it's declared.

## Address replies are array-wrapped

A reply that carries an address is positional like every other: the address is its one
value. `$new` replies `{ re: ['#<:Box:1>'], ty: [':Box'] }`. A self-return replies
`{ re: ['#<:>'], ty: [':'] }` from an actor a `new` built (`:` is its class; its parent
translates both, to `['#<:Box:1>']`, `[':Box']`), and `ty: ['*']` from a declared actor (the
file, a singleton), which knows no `new` built it. Receiving, a `$new` reply's actor is
`re[0]`; a bare `re` there is malformed and the construction fails.

The HTML host (src/codegen/browser/runtime.js) wraps its `$new` and self-return replies too.
Its other replies (`body`, `first`, accessors) still answer bare values, as its whole reply
protocol does; that's its own change.

## Open

- A list of declared actors is tagged `List of Actors`, the plural of its type as any list
  is. Whether the wire should spell the element tag `*` instead.

- Singleton values are broken today (`return s` replies `re: [{}]`). Same fix as above.
- Whether an actor's document should say it has a `new` (its constructor profile), so a
  receiver of a `*`-tagged reference can find out it can build.
