---
status: inbox
created: 2026-11-25
---
# A type declaration should carry a namespace of functions

Design: `notes/type-namespaces-2026-11-25.md`.

```brevity
type Ticket (slug Text, title Text, status Text, created Text) {
  label = (t Ticket) -> "#{t.title}  (#{t.slug})"
  newer = (a Ticket, b Ticket) -> a.created > b.created
}

Ticket.label(t)
:label = Ticket
```

Want:

- The block holds functions only, none that write: a cell, a `!` function or a `.` function in it is a compile error.
- Entries are reached through the type (`Ticket.label(t)`, `t |> Ticket.label`, `:label = Ticket`), never through a value: `t.label` stays a field read, and is an error when there is no such field.
- No `@` and no `self`: the namespace is an Object of functions, not an actor. Siblings see each other by lexical scope.

Open (in the note): an entry sharing a field's name, adding functions to an imported type, and generic types.
