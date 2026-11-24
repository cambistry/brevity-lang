---
status: done
created: 2026-11-03
---
# No address brackets required in `ty` field

**Summary**

No string in ty, at any depth, is wrapped in #<…>. ty is a translated field, like to and from, so its tags don't need the address brackets to be translated. Brackets stay where they mean something, which is to mark an address inside data (re, op).

In exchange, every tag shows by its sigil what it names. Today we're lazy about this:

- **class:** @Name, e.g. @Counter local, Svc @Counter or HTML @div qualified
- **type:** ::Name, e.g. ::Point local, geometry.bv ::Point or HTML ::Event qualified
- **built-in scalar:** bare, e.g. Integer, Text, null, Object (see open question 3)

Today's tags include #<::Point>, #<@Box>, #<HTML @div>, and class tags with no sigil at all (#<Thing>, #<Svc>, #<Math>, #<Element>).

ty must always have the same shape as the value it describes (positional slots, named keys, nesting). This ticket keeps that rule and depends on it.

**Translation**

_Opre convention: a string that starts with a delimiter is local; a global always starts with a letter or digit. This applies to ty as it does to addresses and from._

_A local ty string has each parent's address put in front (::Point → __geometry.bv__ ::Point, @Counter → Svc @Counter). A global ty string (a built-in, or one already qualified) is left alone. The self-reference @ is the one special case (see Self-reference)._ _Each translation site gets a ty step that walks ty at any depth, and the generic #<…> rewrite keeps running on re and op but no longer touches ty. The test is "first character is not a letter or digit", not a list of delimiters. The existing rewrites hard-code lists (#<([@#:][^>]*)?> for addresses, /^[@#]/ for from); change them to the same test, so the three can't drift apart. Sites:_ _- src/codegen/browser/brevity.js:429 (currently a regex over the whole JSON string; needs a real walk to handle ty separately)_

_- src/codegen/browser/runtime.js:2260 (rewriteAddressStrings / translateOutbound)_

_- src/codegen/javascript/classes.js:1114 (#_publishInstance)_

_- src/codegen/javascript/index.js:159 (in-process multi-file relay)_

_Rust and Erlang don't relay messages inside the process, so they have no translation step._

**Self-reference**

An actor can't name its own address or its own class; its parent knows both.

- **"Me":** an actor refers to itself as #<> in re or op, as it does today.
- **"My class":** an actor refers to its own class as a bare @ in the matching ty slot. This is a class with an empty name, the class-level counterpart of #<>. It's local-form, names nothing, and adds no Brevity word to Opre. A bare @ is used nowhere else today.
- **Implied @:** when the whole value is #<>, @ is the only possible tag, so ty is left out: { re: '#<>' }. Inside a structure, a #<> slot must carry its @, so that ty keeps the value's shape.
- **Translation:** the first parent replaces a bare @, stated or implied, with the class part of the sender's address. It does this alongside replacing #<> with the address. This is a special case of the empty form, like #<> → #<addr> already is; the generic rule would give @C/1 @. Once replaced, higher parents translate the result like any other local tag.

```text
┌────────────────────────────────────────────────────────────┬────────┬─────────────────────────────────────────────────────────────────┐
│                        Child sends                         │ Sender │                      First parent makes it                      │
├────────────────────────────────────────────────────────────┼────────┼─────────────────────────────────────────────────────────────────┤
│ { re: '#<>' }                                              │ @C/1   │ { re: '#<@C/1>', ty: '@C' }                                     │
├────────────────────────────────────────────────────────────┼────────┼─────────────────────────────────────────────────────────────────┤
│ { re: { me: '#<>', n: 1 }, ty: { me: '@', n: 'Integer' } } │ @C/1   │ { re: { me: '#<@C/1>', n: 1 }, ty: { me: '@C', n: 'Integer' } } │
└────────────────────────────────────────────────────────────┴────────┴─────────────────────────────────────────────────────────────────┘
```

The wire for a whole-reply self-return doesn't change. The 2026-11-03 work already sends { re: '#<>' } and has the parent add the class (javascript/classes.js:1122, rust/program.js:1727, erlang/preambles.js:704). What's new: those sites produce @C instead of #<@C>, and a #<> inside a structure carries a bare @.

**Emitters**

**Type tags** (tagFor) emit ::Name or authority ::Name:

- src/codegen/javascript/expressions.js:1315
- src/codegen/rust/types.js:233
- src/codegen/erlang/types.js:15
- the browser runtime's event tag, browser/runtime.js:1954 (#<HTML ::Event> → HTML ::Event)

**Class tags** emit @Name or authority @Name:

- JS: javascript/classes.js:131 (#new reply), javascript/classes.js:1122 (self-return)
- Rust: rust/handlers.js:303 (#new reply), rust/program.js:1727 (self-return)
- Erlang: erlang/program.js:633 (#new reply), erlang/preambles.js:704 (self-return)
- Browser: browser/runtime.js:997, 2016 (HTML @tag), 2152, 2209, 2217 (#<Element>, see open question 4)

**Self-references nested in a value** emit a bare @ in their ty slot. The places that build ty for replies and arguments (genTyBody and its Rust and Erlang counterparts) need a case for a slot holding #<>. I haven't checked whether Rust or Erlang tag a nested #<> today.

**Readers**

- **Bracket-stripping code is removed:**
- javascript/runtime/wire.js:31 (_bv_from_wire)
- javascript/preambles.js:650 (bareName)
- rust/program.js:893 and erlang/preambles.js:31 (bv_type_name)
- any bv_sel path that reads tags rather than addresses
- **JS isTypeTag** (javascript/preambles.js:661) becomes "contains ::". Today it requires a leading :: or #<, which geometry.bv ::Point has neither of.
- **One-actor reply check** (rust/program.js:1760, erlang/preambles.js:1098): today it tests that ty starts with #< and has no ::. It becomes: the reply is one actor when re is #<X> and ty is absent or equals X without its trailing /N. That doesn't depend on brackets or on the tag's shape. A file class tagged Thing and a scalar tagged Integer would otherwise look the same.

**Tests**

- About 66 lines in 16 files have a bracketed ty at the top level, plus nested ones ({ coords: '#<::Point>' }, [{ c: '#<Widget ::Control>' }], [['#<HTML ::Event>']]).
- Test inputs that send class tags without a sigil change too ('ty': '#<Thing>' in classes/dependency_injection.test.js, '#<Svc>' in classes/public_class_across_files.test.js, and similar).
- type_tag_translation.browser.test.js locks in the translation. Its expected values change to the bare form.
- New tests are needed for: a nested self-reference (ty: { me: '@', … } translated to @C) on every target; ::Point and @Counter translated one level and two levels up in the browser; and the one-actor reply check with a file class (ty: 'Thing') against a Text reply that starts with #<.

**Docs**

- notes/type-authority-address-tags-2026-10-26.md: this ticket replaces its "a type tag is an authority address in #<…> form". Keep the authority idea, drop the brackets.
- notes/session-2026-11-03-self-return-like-new.md: the parent now produces ty: '@C', not '#<@C>'.
- notes/mutation-suffix-2026-10-31.md (self-return shape), docs/CAM.md, docs/VALUES_AND_ACTORS.md.
- notes/session-2026-11-03-ty-key.md: replace its "Next" section with a pointer to this ticket.

**Open questions**

1. **A sender that isn't an instance.** What does @ become when the sender has no /N, for example a file actor at c.bv?
- If a file actor is an actor of its own class, @ → c.bv (the same rule, with nothing to strip).
- If it isn't (the file is the class, and its actors are only what #new makes), a file actor can't send @.
1. **"Me as a class".** Today's 'Class' tag (self/self_class.test.js:89: re: '#<c.bv>', ty: 'Class'; emitted at javascript/classes.js:166 and rust/handlers.js:277). Proposal: it becomes #, as in the header W #, "this is a class you construct from". The child sends { re: '#<>', ty: '#' }. The generic rule translates that to c.bv #, so it needs no special case. Readers treat a bare # or a trailing  # as a class value. The open part is whether # alone is too close to the #name private sigil.
1. **Built-in scalars stay bare.** Integer, Text, null, Object, List of Integers. Recommendation: yes. They start with a letter, so translation leaves them alone, and they have no authority to name. Writing ::Integer would make every parent prefix them.
1. **Element from the browser document.** browser/runtime.js:2152, 2209, 2217 tag the elements that document queries return as #<Element>, with no sigil and no authority. What should the tag be: HTML @Element, the element's real tag (HTML @div), or something else?
1. **Local types sent by an instance.** An instance @C/1 that sends ::Point gets @C/1 ::Point from the generic rule. But the type belongs to the file, not to the instance. That's harmless today because type matching ignores authority, but the identity is wrong. The same problem exists now with #<::Point>. Decide whether an instance's parent puts the class address in front (@c ::Point), or the file's address directly, or whether this is left for later.

**Related, separate ticket**

ty describes the data actually sent, so it never holds a union or a placeholder. Today replies are tagged with the declared type: { result: 'Integer | null' } with re: { result: 42 }, plus 'Anything' in core_types/list.test.js:170. The fix is to tag from the value at runtime when the declared type is a union or Anything, the way List of Anything already does. The scope is written up in notes/session-2026-11-03-ty-key.md.
