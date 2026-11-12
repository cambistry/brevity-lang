# `@` is internal to Brevity; quoted names — 2026-11-12

Design decision, not implemented. Builds on `opre-addresses-as-tokens-2026-11-11.md` (tokens,
space-delimited) and `protected-names-dot-prefix-2026-11-11.md` (`.a` / `@a` / `#a`).

## `@` leaves the wire

`@` is no longer a universal Opre prefix on public names. It is a Brevity sigil, like `.` and `#`.
Public names travel bare:

```
before                     after
#<HTML @div>               #<HTML div>
path/to/service @a /1      path/to/service a /1
main @s @get               main s get
```

Inside Brevity nothing changes: `.` and `#` still prefix local protected and private names, and
`@` stays part of the local name of a public member:

```
@var
@singleton method
```

- **`@` only touches the head of an address.** Later segments are local to child contexts, not to
  the immediate one. Each child spells its own public names with `@` internally; the address that
  reaches it doesn't. So `@singleton method`, not `@singleton @method`.
- **Opre knows only space delimitation,** plus the self token `@` (below). As prefixes, `@`, `.`
  and `#` mean nothing to it; they're Brevity's internal convention.

## Quoted names

A token containing spaces is written in single quotes:

```
'file/with spaces/' Name
```

- **Quotes are valid only when required.** `'no-spaces-here'` is an error.
- **Single quotes self-escape inside quotes:** `'this isn''t ready'`.
- **Doubling is only valid inside quotes.** Unquoted, `'` is an ordinary character:
  `Chris's-Computer`, never `'Chris''s-Computer'`.
- Replaces the `\ ` space escape in `opre-addresses-as-tokens-2026-11-11.md`.

### External names that start with a sigil

Locally, quotes also mark an external name that begins with one of Brevity's internal sigils, so it
isn't read as a local label:

```
'@foreign'          // a non-local name that happens to start with @
'.hidden.file'
```

On the public wire the quotes drop: the token is just `@foreign` / `.hidden.file`.

- **A token that starts with `'` must be quoted:** `'''tis'`. This is a narrow exception to
  "quotes only when required": unquoted, the leading `'` would open a quote.

So quoting is required exactly when a token contains a space, starts with `'`, or (locally)
starts with `@`, `.` or `#`.

## `@` is self: the relative-address marker

An Opre-level convention. The token `@`, exactly, is a specific actor: self. An address whose head
token is `@` is relative to the sender:

```
@ opname                 // child-relative
file/path Svc 1          // global
'@' abc                  // quoted: a global whose head token is literally `@`
```

- **The test is mechanical:** head token `@` means relative; anything else is global. A host needs
  no knowledge of Brevity's sigils.
- **Only the exact token is reserved.** `@something` is an ordinary token and may refer to
  anything (it may name libraries or system resources in the Opre ecology).
- **Translation per hop:** a parent receiving `@ x` from child `c` rewrites it to `@ c x`. That is
  still relative, now to the parent. The node at the global boundary replaces `@` with its own
  address.
- **Payload addresses still need `#<…>`.** `@` marks locality; the brackets mark that a string is
  an address: `#<@ Box 1>`. `to`, `from`, `re` and `ty` are known address fields.
- **What follows the head is the sender's business.** How an actor or subactor formats the rest of
  its address isn't Opre's concern.
- **`ty` tags follow the same rule.** A local type tag is `@ ::Point`, not `::Point`. It is no
  longer local by virtue of its leading delimiter.

## Supersedes the leading-character local/global rule

This replaces the broad "a leading delimiter means local; a leading word character means global"
rule (`address-delimiter-change-plan-2026-04-23.md`, and its use in
`protected-names-dot-prefix-2026-11-11.md`). Apart from the reserved head token `@`, a wire token
may start with any character: `.hidden.file` and `@foreign` are ordinary names. Within Brevity
source, locality is expressed by the sigils and quoting above.

## Not affected

- **Intrinsic ops** (`#set`, `#new`). These are ops, not addresses. The `op` field is outside this
  decision.
- **Consumption:** wire `a` is consumed in Brevity as `x.a`, unchanged in source; only the wire
  spelling moves from `@a` to `a`.

## Open

- **`ty` "my class"** stays a bare `@` for now. A dot (`.`) is a contender to replace it. Under the
  self convention it reads as "the sender's own frame", which may let `ty` translation share the
  address rule.
- Migration: every target's routing, tagging, subscriber keys, and every test's addresses.
