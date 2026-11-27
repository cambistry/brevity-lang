---
created: 2026-11-03
---
# Opre: escape a literal #< in message strings

Want: a #<…> in a message string is always an address. A literal `#<` in text is sent as `\#<`, and a literal `\` as `\\`. Inside an address, a literal `>` is `\>`. The rule was designed on 2026-04-23 (notes/address-delimiter-change-plan-2026-04-23.md).

Today: only the inside-address part exists (encAddr/unescAddr, JS only).

- Encode when a Text value goes on the wire, and decode when one comes off, on every target.
- Make every address rewrite skip an escaped `\#<`: #_publishInstance, runActors, browser rewriteLocalAddresses and translateOutbound, the DOM stripMatchingAlias, and the readers that test for a #< prefix.
- Tests: a Text reply containing #<@x> round-trips unchanged through one and two parents, on every target.
- Then a bare #<…> in re is unambiguously a reference, and the one-actor check could be just "re is #<…>", once replies that refer to an endpoint (*Integer) are designed.

**Decided (2026-11-27):** decoded. The escape is Opre's alone: a Brevity program sees a string or
an address, never `\#<`. A Text holds plain characters, and is escaped going onto the wire and
unescaped coming off it. An address is its own kind of value, not Text.

Done before the decision: the rewrite half. `_opre_map_bracketed` (`src/codegen/opre_tokens.js`)
skips `\#<` and `\\`, and `cam/address_translation.test.js` checks a literal passes unchanged.

**Decided (2026-11-27):** no address literal for now. An address comes only from a value (`self`,
an actor, `&f`, a reply), and a test that writes one as a string is rewritten to make it. A source
form for an address is to come with backticks (`notes/backticks-as-dynamic-names-2026-04-16.md`).

**Decided (2026-11-27):** the static type decides. A value typed `Text` is text, so its `#<` is
escaped on the wire, whatever it contains. A value typed with an actor or a class (`self::class`)
is an address, and a string where one is declared is a type error, even the right string (`"#<:>"`).

**Depends on:** `a-lambda-as-a-value-is-its-address`. `functions/closure_subscribe_interop.test.js`
writes a closure's address as the string `"#<:@0>"`; with no address literal it has to come from
the lambda as a value, which today goes out as a bare internal label.

**The tests that write an address as a string in source:** `cam/address_translation.test.js`,
`browser/address_boundary.dom.test.js`, `functions/closure_subscribe_interop.test.js`. The others
with `#<` hold wire messages, which keep them. An address of another actor (`#<main:x>`) can't be
made from a value here, so those cases take it as a param from the harness.

**Decided (2026-11-27):** the address-translation tests are a test problem, not a type one. Today's
`(near: "#<:x>")` reply is Text: on the wire it's `\#<:x>`, never rewritten, so a test relying on
its rewrite is wrong. The tests are black-boxed with Opre messages, and every address in them is a
typed value: one the actor makes (`&x`, `self`, a lambda, an actor), or one the harness sends in as
a typed arg (a global or quoted address, with its `ty`, such as a function's signature) and checks
coming back out. No new `Address` type.

**Done (js):**
- `src/codegen/javascript/runtime/wire.js`: `_bv_text_esc`, `_bv_text_unesc`, and `_bv_text_map`,
  which walks a value with its `ty` tag. `_bv_from_wire` unescapes `Text` slots, so a consumed reply
  and a request's typed args are decoded.
- `classes.js`: a reply with a `ty` is encoded at `_post`, and `#send` encodes a request's args.
- `core_types/text_interpolation.test.js`: a literal backslash goes out as `\\`.
- `functions/closure_subscribe_interop.test.js`: replies `&f`, not `"#<:@0>"`. A reference to a
  lifted closure (`&f` of `f = { content }`) is renamed with it (`src/extract_passes.js`), and a named
  reply field's `&f` is its address (`src/validate.js` lowerFnRefReplies).

**Next:** the address-translation tests, once answered; then erlang and rust (encode by `ty` where
a reply or request is built, decode where args are packed and replies consumed); the browser
runtime's readers.
