# Session 2026-11-03: `ty` tags have no `#<…>`

No string in `ty`, at any depth, is wrapped in `#<…>`. `ty` is a translated field, like `to` and
`from`, so its tags need no brackets to be translated. Brackets stay where they mark an address in
data (`re`, `op`).

```
before:  { re: '#<@Box/1>', ty: '#<@Box>' }      { ty: { coords: '#<::Point>' } }
after:   { re: '#<@Box/1>', ty: '@Box' }         { ty: { coords: '::Point' } }
```

## Rules

- **Tags carry their sigil.** Class `@Name` or `authority @Name`; type `::Name` or `authority ::Name`;
  built-in scalars bare (`Integer`, `Text`, `null`, `List of Integers`).
- **Local vs global (Opre convention):** a string that starts with a delimiter is local; a global
  starts with a word character. Each parent puts its address in front of a local `ty` tag
  (`::Point` → `main ::Point`) and leaves a global one alone. Translation sites now test "starts
  with a word character" instead of listing delimiters, for `#<…>` addresses, `from` and `ty` alike.
- **Self-reference.** An actor says "me" with `#<>` in `re`/`op` and "my class" with a bare `@`
  in `ty`. When the whole value is `#<>`, the `@` is implied and `ty` is left out: `{ re: '#<>' }`.
  The parent that made an actor `@C/N` replaces a bare `@`, stated or implied, with `@C`. For any
  other sender a bare `@` translates by the generic rule (`main @`).
- **One-actor reply** (Rust `await_response`, Erlang `bv_self_reply_`): `re` is `#<X>` and `ty` is
  absent or X without its trailing `/N`. It no longer depends on brackets or tag shape.

## Where

- **Emitters:** `typeTag` (JS), `rustTypeTag`, `erlTypeTag`; `#new` class tags in
  `javascript/classes.js`, `rust/handlers.js`, `erlang/program.js`; self-return tags in
  `#_publishInstance`, `rust/program.js` (published instance), `erlang/preambles.js` (`bv_forward_`);
  browser `selfReply`, `handleDomNew`, the `HTML ::Event` tag.
- **Translation:** `#_publishInstance` (`classes.js`), `runActors` (`javascript/index.js`),
  `rewriteLocalAddresses` (`browser/brevity.js`), `translateOutbound` (`browser/runtime.js`). Each
  pulls `ty` out of the message and walks it separately; the `#<…>` rewrite skips it.
- **Readers:** `_bv_from_wire` (`runtime/wire.js`), `bareName` / `isTypeTag` (JS preamble; a type
  tag is any tag containing `::`), `bv_type_name` (Rust, Erlang). Bracket-stripping removed.

## Decisions on the ticket's open questions

1. **A sender that isn't an instance.** A whole-value `#<>` from a file actor still gets no `ty`
   (it has no class); a nested `@` translates by the generic rule (`main @`).
2. **`'Class'` stays.** `Self` sends the compiled global address (`#<c.bv>`), not `#<>`, so `#`
   would be translated to `<parent> #` beside an untranslated `re`. Switch to `#` when `Self` sends
   `#<>`.
3. **Built-in scalars stay bare.**
4. **Document elements** (`document @first`, `@body`, legacy `@append!`) are tagged
   `HTML @<tag>` (`HTML @body`), like created nodes, instead of `#<Element>`. Their legacy
   addresses (`document body`) don't end in `/N`, so they don't pass the one-actor check; nothing
   in Rust or Erlang talks to the DOM, so this doesn't matter yet.
5. **Local types sent by an instance** still get the instance's address (`@C/1 ::Point`). Left for
   later; type matching ignores authority.

## `self` as one slot of several

`return (self, 1)` → `{ re: ['#<>', 1], ty: ['@', 'Integer'] }`; `return (me: self, n: 1)` →
`{ re: { me: '#<>', n: 1 }, ty: { me: '@', n: 'Integer' } }`. `return self, 1` (no parens) is the
same. `(self)` alone is the whole reply, like `self`. This is the case that needs the bare `@`.

- **Parser:** `parseReplyFields` takes `self` as a positional slot or a named value
  (a `SelfValue` expression). The old error "'self' can't be one of several return values" is gone.
- **Emitters:** the `ty` builders (`genTyBody` JS, `genRustTyBody`, Erlang `genTyBody`) tag a
  `SelfValue` slot `@`. `re` already emitted `#<>` for it.
- **Wire parent of an `@C/N` actor:** swaps `#<>` for `#<@C/N>` and `@` for `@C` at any depth
  (`localTy` in JS `#_publishInstance`; `bv_swap_self` / `bv_swap_self_tag` in Rust's
  published-instance branch; `bv_swap_self_` / `bv_swap_tag_` in Erlang `bv_forward_`).
- **In-process parent:** swaps `#<>` for its handle on the child at any depth (JS `#childSend`;
  Rust `child_<c>_dispatch_at`; Erlang instance loops, with `self()`).
- **In-process caller** of `(a, k) = b.pair()`, then `a.get()`:
  - JS: `#childSend` takes a handle dynamically.
  - Rust: a local that holds an address is checked at run time; one naming our own child
    (`<class>/<id>`) is dispatched in process instead of sent.
  - Erlang: statically, as for whole-value self-returns: when every return of `pair` has `self`
    in that slot (`slotOnlySelf` in `chains.js`), the name is a pid.

## Tests

- Bracketed `ty` values stripped across 22 test files (97 values), including inputs with class tags
  that have no sigil (`'ty': 'Thing'` beside `re: '#<Thing/1>'`).
- `type_tag_translation.browser.test.js`: the `#new` reply and a self-return from a public class,
  through two parents (`'#<main @Box/1>'`, `ty: 'main @Box'`).
- `public_class.test.js` "self as one of several return values": positional and named on the
  wire, and an in-process caller that destructures and calls the actor, on every target.
- `type_tag_translation.browser.test.js`: `(self, n)` through two parents
  (`['#<main @Box/1>', 1]`, `['main @Box', 'Integer']`).
- `bang.test.js`: "cannot be one of several return values" became "can be".

## Not done

- **A `#<…>` in `re` is always an address**, never Text. A reply that is a reference to an
  endpoint (e.g. `count () -> (*Integer)`, `{ re: '#<Thing/1 @n>', ty: '*Integer' }`) needs
  design. Then the one-actor check could be just "`re` is `#<…>`", and `*Integer` is a local tag
  under the delimiter rule (parents prefix it). Untested for now.

- Unions and `Anything` in `ty` (separate ticket; scope in `session-2026-11-03-ty-key.md`).
