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
- **Opre knows only space delimitation.** `@`, `.`, `#` mean nothing to it; they're Brevity's
  internal convention.

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

## Supersedes the leading-character local/global rule

These rules replace the broad "a leading delimiter means local; a leading word character means
global" rule (`address-delimiter-change-plan-2026-04-23.md`, and its use in
`protected-names-dot-prefix-2026-11-11.md`). On the public wire a token may start with any
character: `.hidden.file` and `@foreign` are ordinary external names. Locality is a Brevity
source-level matter, expressed by the sigils and quoting above.

## Not affected

- **Intrinsic ops** (`#set`, `#new`). These are ops, not addresses. The `op` field is outside this
  decision.
- **Consumption:** wire `a` is consumed in Brevity as `x.a`, unchanged in source; only the wire
  spelling moves from `@a` to `a`.

## Open

- **`ty` "my class"** stays a bare `@` for now. A dot (`.`) is a contender to replace it.
- Migration: every target's routing, tagging, subscriber keys, and every test's addresses.
