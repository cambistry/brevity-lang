---
status: done
created: 2026-11-15
---
# Opre addresses: colon replaces space as the token separator

Spec (currently a proposal; mark it decided as part of this ticket): notes/opre-colon-separator-2026-11-14.md

Revises: notes/opre-addresses-as-tokens-2026-11-11.md (token rules) and notes/at-sigil-internal-and-quoted-names-2026-11-12.md (self/relative head).

Rules

- Tokens are separated by `:` instead of a space.
- A leading `:` marks a relative (self) address: `:template` replaces `. template`. A bare `:` is self: `#<:>` replaces `#<.>`, and `ty: ':'` (my class) replaces `ty: '.'`.
- A token containing a colon is wrapped in single quotes; `''` is a quote inside quotes. Quotes are invalid when not required.
- Spaces are ordinary token characters. A token with a space is no longer quoted (quoting it becomes invalid).
- Empty tokens are invalid, so `::`, a trailing `:`, and `:` after the head never appear.
- Sigils are unchanged: public bare, `~` protected, `#` private, `$` intrinsic ops.

```
Examples, before -> after
  to: 'HTML div'                -> to: 'HTML:div'
  re: '#<Svc Thing 1>'          -> re: '#<Svc:Thing:1>'
  from: '. template'            -> from: ':template'
  to: '. ~val'                  -> to: ':~val'
  re: '#<.>'                    -> re: '#<:>'
  ty: 'svc.bv Point'            -> ty: 'svc.bv:Point'
  to: "'My Notes.bv' x"         -> to: 'My Notes.bv:x'
  (a token with a colon)        -> to: "'bluster://n1':inbox"
```

Scope

- Shared: the address tokenizer/joiner and its escaping (src/codegen/opre_tokens.js), wire labels (src/codegen/wire_labels.js), ty tags (src/codegen/ty_tags.js).
- JS, Rust and Erlang: codegen for every address built or parsed, the runtimes' translation (parents prefixing their alias, `_opre_under` and equivalents), the routers that split `to` (published actors, singletons, `$new` to `. C`), and the bracketed-address handling in payloads.
- Browser runtime (src/codegen/browser/runtime.js): element factory addresses and `#<…>` handling.
- Tests: every wire expectation that contains an address, test relays and harnesses that build or split addresses, and tokenizer unit tests. Add cases for: a quoted token with a colon, `''` inside quotes, a token with a space (unquoted), rejection of unneeded quotes, rejection of empty tokens (`::`, trailing `:`), bare `:` as self, and relative heads through parent translation. Run on all three targets.
- Notes: mark the colon-separator note decided; update the 2026-11-11 and 2026-11-12 notes (token rules, `.` head -> leading `:`) so they point to it.

Out of scope

- The `HTML:div` header shorthand from the spec. The header still reads `HTML:div` as the alias `HTML: div`.
- `trace` attribute rules for tokens that contain spaces (left open in the spec).
- Addresses with URIs or ports (a Bluster/topology question). They only need the quoting rule.

Done when

- No address on the wire uses space-separated tokens or a `.` head token.
- Tests pass on js, rust and erlang.
