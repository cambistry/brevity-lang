# Type namespaces: functions that belong to a type — 2026-11-25

Proposal, not implemented. Came out of `kanban/board.bv`, where `Ticket` gathers helpers
(`ticketFrom`, a label, a sort order, its file path) that have no home but file level. Relates to
`type-class-split-2026-04-25.md`, `binderless-type-declaration-2026-10-25.md` and
`type-keyword-and-actor-scoped-types-2026-11-13.md`.

## Proposal

A type declaration may carry a block of functions. They are reached through the type, as the core
types' functions are (`Text.before`, `List.take`):

```brevity
type Ticket (slug Text, title Text, status Text, created Text) {
  label = (t Ticket) -> "#{t.title}  (#{t.slug})"
  newer = (a Ticket, b Ticket) -> a.created > b.created
  path = (slug Text) -> "kanban/tickets/#{slug}.md"
}

Ticket.label(t)
t |> Ticket.label
:label, :newer = Ticket
List.sort(tickets) (a, b) { Ticket.newer(a, b) }
```

## It is a namespace, not an actor

`type-class-split-2026-04-25.md` settled that a type's values have no methods: they are plain data.
This doesn't change that. The block belongs to the type, not its values, and it is a collection of
functions, not an object:

- **No `@`, no public/private split.** Every function in the block is reachable as `Ticket.name`.
  A helper that shouldn't be shared lives at file level, outside the type.
- **No `self`.** Siblings in the block see each other by ordinary lexical scope, as in any block.
- **`Ticket.label(t)` reads an entry and calls it,** as `t.slug` reads a field. It is not a
  message. The namespace is data: an Object whose named entries are functions.
- **Not the `^` form.** `^ { … }` composes actors (a class's singleton layer); a type's functions
  are not an actor's members, so the plain block after the declaration is the honest spelling.
- **`Text` and `List` are the same kind of thing:** core namespaces of functions, which is how
  they behave already. `:before = Text` reads entries from an Object.

## Rules

- **Functions only, and pure.** No cells, no `!` functions, no `.` (silent) functions: a
  namespace has nowhere to keep state. Beyond not writing, each function should be pure: it reads
  no external mutable actor or cell except through its params, and calls only pure functions
  (ticket `document-pure-functions-in-the-service-document`). Anything else in the block is a
  compile error.
- **Called through the type, never the value.** `t.label` would collide with field reads, and
  values don't receive messages. `Ticket.label(t)`, `t |> Ticket.label`, or a destructure.
- **Entries can be clause lists.** `Ticket.from` overloaded on what it's built from is an ordinary
  function, which is a list of clauses (`clause-lists-2026-11-25.md`).

## In `board.bv`

`ticketFrom` becomes `Ticket.from(slug, file)`; the status line's `"#{t.title}  (#{t.slug})"`
becomes `Ticket.label(t)`; the newest-first comparator becomes `Ticket.newer`; and the list-file
path `"#{LISTED_PREFIX}#{card}.md"` becomes `Ticket.path(card)`, keeping the file layout in one
place.

## Open questions

- **Name collisions with fields.** May a namespace entry share a name with a field
  (`Ticket.title` as a function while `t.title` is a field)? They're reached differently, so it's
  unambiguous, but it may read badly.
- **Types declared elsewhere.** Can a file add functions to a type it imports, or only the
  declaring file? (Only the declaring file keeps a type's namespace in one place.)
- **Generic types.** How a parameterised type's functions name its parameter
  (`type Pair[T] (a T, b T) { swap = (p Pair[T]) -> … }`).
