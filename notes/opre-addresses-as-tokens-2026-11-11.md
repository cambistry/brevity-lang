# Opre addresses as space-delimited tokens — 2026-11-11

Design proposal, not implemented. An Opre address is a path of space-delimited tokens. A token
can hold any characters, sigils included: they're just part of the token.

**Superseded in part by `at-sigil-internal-and-quoted-names-2026-11-12.md`:** a token with a space
is quoted (`'my file.bv'`, `''` for `'`), replacing the `\ ` escape below, and the whole token `.`
at the head of an address is self, making it relative to its sender.

Out of scope: local messaging and ops.

Builds on `address-delimiter-change-plan-2026-04-23.md` (`#<…>`) and
`classes-as-singletons-2026-11-09.md` (`main @s @get`).

## Why

Opre is not just Brevity. An address format that reads meaning into Brevity's sigils makes
Brevity code look native on the wire and everyone else's look translated. Treating every character
other than the separator as part of a token keeps the format language-neutral.

## Shape

```
factory.bv s get       tokens: factory.bv, s, get
main @s @get           tokens: main, @s, @get
main Box /1 tally      tokens: main, Box, /1, tally
```

- **Tokens are separated by spaces.** Nothing else separates them. Quotes, dots, slashes, `@`,
  `#` and every other character are ordinary token characters.
- **Escapes:** a backslash escapes a significant space (`my\ file.bv`). Inside `#<…>`, `\>` and
  `\\` stay as they are.
- **What goes in a token is the sender's business.** The protocol only compares tokens.
- **"My class" in `ty`** stays a bare `@` for now.

## Why space, not dot

There's a strong case from precedent for `.`, and it would work the same way: one separator,
escaped where it's significant. But an Opre application is a cluster of files that interact and
refer to each other by their actual file paths. A file path almost always contains a dot, so with
a dot separator many or most messages would need an escape in their very first token:

```
factory\.bv.s.get
factory.bv s get
```

Space flips that: file paths rarely contain spaces, so the escape becomes the rare case.

## Open

- Migration: every target's routing and tagging, and every test's addresses.
