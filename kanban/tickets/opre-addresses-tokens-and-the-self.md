---
status: done
created: 2026-11-13
---
# Opre addresses: tokens and the self .

**Background.** Design: notes/at-sigil-internal-and-quoted-names-2026-11-12.md.

- An Opre address is a sequence of space-delimited tokens.
- The whole token . at the start of an address means self, and makes the address relative to the sender.
- Public names travel without @.
- This replaces the leading-character rule ("a leading delimiter means local; a leading word character means global"), which every runtime uses today to decide whether a parent should add its own name in front of an address.

**Scope.**

1. **Token** **module** (src/codegen/opre_tokens.js, shared by every target that needs it at compile time; mirror it in the runtimes):
- split(address) gives tokens and join(tokens) gives an address.
- Quote a token with '…' only when it contains a space, starts with ', or is a reserved whole token meant literally ('.').
- Inside quotes, '' is an escaped '. Outside quotes, ' is an ordinary character (Chris's-Computer).
- Quoting a token that doesn't need it is an error ('no-spaces-here').
- isRelative(address): the first token is exactly ..
1. **The** **self** **token** **replaces** **the** **leading-character** **rule** in every translator:
- src/codegen/browser/runtime.js (rewriteAddressStrings, rewriteTyTags, translateOutbound, around line 2220);
- src/codegen/javascript/index.js (promote / promoteTy, around line 158);
- src/codegen/javascript/classes.js (#_publishAt, around line 1218, and the instance/singleton routing in receive, around line 1263);
- src/codegen/browser/brevity.js (the test harness's translation);
- the Rust and Erlang equivalents, including brevity_router.erl.

A parent that receives . x from child c rewrites it to . c x. The node at the global boundary replaces . with its own address. An address whose first token isn't . passes through unchanged.

1. **What gets emitted:**
- Self: #<> becomes #<.>.
- Instances: #<@Box/1> becomes #<. Box 1> (spaces only, no slash).
- Singletons and sub-services: @s becomes . s, and main @s @inner becomes main s inner.
- Public members in addresses go bare: HTML @div becomes HTML div.
- ty: "my class" @ becomes ., a local class tag @Box becomes . Box, and a local type tag ::Point becomes . ::Point.
- src/opre.js: member-path tokens are bare.
1. **Every place that writes an address goes through the token module,** so a file path or name containing a space is quoted.

**Out of scope.**

- Op names: op: '@ping' keeps its @, which is ticket 2.
- Protected and private labels, and built-in ops.
- Quoted names in Brevity source (ticket 4).

**Tests.**

- Unit tests for the token module: split and join round-trips, quoting required versus invalid, '', a leading ', '.'.
- Rewrite about 330 address sites (#<@…>, to: '… @…', from, re, ty) by script, then review the diff by hand.
- Add translation tests at each hop: child to parent to global boundary, for to, from, re, ty and a #<…> in the payload.
- Add a test that a global address whose first token is .hidden.file or @foreign passes through untranslated.

**Done when.**

- No runtime tests the first character of an address to decide local versus global.
- Every relative address the compiler emits starts with ..
- Each target's suite passes.
- The comments in the translators describe the new rule.
- opre-addresses-as-tokens-2026-11-11.md gets a pointer to the 11-12 note, which supersedes its \  escape.
