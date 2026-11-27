# Opre: Text and addresses are told apart by type — 2026-11-27

Decided with the user on 2026-11-27. Builds on `address-delimiter-change-plan-2026-04-23.md`, which
set the wire escapes (`\#<` a literal `#<`, `\>` a literal `>` inside an address, `\\` a literal
`\`).

## Decoded Text

The escape is Opre's alone. A Brevity program sees a string or an address, never `\#<`. A `Text`
holds plain characters: going onto the wire it's escaped, coming off it's unescaped. Any `#<…>` in
a field other than `from`, `to` or `ty` is an address, and a literal `#<` there must be escaped.

## The static type decides

Text and an address are both strings at run time on every target, so the encoder goes by type:

- A value typed `Text` is text. Its `#<` is escaped, whatever it contains.
- A value typed with an actor or a class (`self::class`), or a function, is an address and passes
  as it is.
- A string where an address type is declared is a type error, even the right string (`"#<:>"`).

## No address literal, for now

An address comes only from a value: `self`, an actor, `&f`, a reply. A string can't stand in for
one, so a test that writes an address as a string makes it from a value instead. An address of
another actor (`#<main:x>`) comes in as a param. A source form for an address is to come with
backticks (`backticks-as-dynamic-names-2026-04-16.md`).

## Rejected

- **Text as the wire form** (today's behaviour): a source string `"#<:x>"` is an address, and a
  literal is written `'\#<:x>'`, with the backslash kept in the value. Text then isn't text.
- **A distinct runtime value for addresses** on every target. Robust, but `self`, actor values,
  `&f` and instance refs are all plain strings today; the static type is enough.
- **An address literal `#<…>` in source**, or **`"…" as Address`**: deferred to backticks.
