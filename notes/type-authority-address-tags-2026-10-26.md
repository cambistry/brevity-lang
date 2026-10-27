# Type wire identity = authority address (2026-10-26)

Design decision + implementation plan. A type's `bv-a` wire tag must carry the
type's **authority address** — where it is defined — not a bare `::Name`. This
was always the intent (types-implementation-plan-2026-04-27, lines 297/326:
`#<geometry.bv ::Point>`); the type-wire slices shipped the simplified bare
`::Name`, and the `HTML::Event` work inherited it. This note settles the real
form and the refactor across the type system and all three targets.

Status: **decided, implementing.** Settled with the user 2026-10-26.

---

## Why

A type is not a universal abstraction. `::Event` is just a name; any service
can define a different `::Event`. What disambiguates it is *where it is defined*
— its authority. Inside HTML, Event's identity is `HTML::Event`; on the wire
that is `#<HTML ::Event>`. Carrying only `::Event` conflates distinct types.

Authority is **path-qualified**, not content-addressed. Content addressing
(path + BLAKE3) is not native to Brevity messaging; it is a routing-layer
concern (Bluster) that can layer on later. The native wire identity is the
path.

## The form — a type tag is an address

A type tag reuses the `#<alias selector>` address machinery, with a `::Name`
selector:

- **Local type** (defined in this compilation): `#<::Name>` — empty authority,
  `:`-leading selector. By the local-vs-global discriminator (non-word-char
  start = local), this is a *local-form* address, exactly parallel to a local
  endpoint `#<@N>`.
- **Imported / cross-module type** (defined elsewhere): `#<path ::Name>` —
  explicit authority = the dependency's **path** (`#<geometry.bv ::Point>`,
  `#<HTML ::Event>`), *not* the importer's local alias (which isn't stable).
  Word-char start = global-form.

## Perspective translation — local tags travel like any address

A local type tag `#<::Name>` is perspective-relative and translated by parents,
exactly like `#<@N>`: as a value crosses an actor boundary, the parent prepends
its own address, so `#<::Name>` → `#<path ::Name>`. This is the same
`rewriteLocalAddresses` seam; the only change is the discriminator must treat a
`:`-leading selector as local (prepend), alongside `@`/`#`:

```
/#<([@#][^>]*)>/g   →   /#<([@#:][^>]*)>/g
```

An imported tag `#<geometry.bv ::Point>` is global-form (word-char start) and is
left alone — correct, because the type's authority is that other module, not the
current actor. So:

- type defined here → `#<::Name>` → authority filled by translation as it rises;
- type defined elsewhere → `#<path ::Name>` emitted directly, never rewritten.

## Matching — by name (authority rides for identity)

Because the authority path is perspective-relative (frame-dependent) and the
type *name* is the stable local identifier, handler-param matching compares the
**bare type name** extracted from any tag form. The authority travels in the tag
for identity, reconstruction routing, and future (Bluster) verification, but v1
matching is name-based. Cross-authority rejection (two different `::Event`s) is
a Bluster-layer identity concern, deferred.

`bareName(tag)` handles every form: `#<HTML ::Event>` → `Event`,
`#<::Event>` → `Event`, `::Event` → `Event`, `HTML::Event` → `Event`,
`Event` → `Event`, `Integer` → `Integer`.

## Reconstruction — by name

`_bv_from_wire(tag, payload)` extracts the `::Name` selector from any tag form
and looks up the field shape in the per-program `_bv_types` registry (keyed by
bare name). Payload shape (positional vs named map) is unchanged.

## Implementation surface (per target: js, rust, erlang)

1. **Authority on type decls.** When building `ctx.typeDecls`, tag each entry
   with `authority`: `''` for a local type (`ast.types`), the dependency path
   for an imported type (`importedTypes[*].sourceAlias` is already the path) or
   a cross-module type (`ast.crossModuleTypes` — extend the validate-time stash
   to record the dep path, resolving alias → path via `ast.dependencies`).
2. **Emission.** The single tag builder (`tagFor` in JS `genBvaBody`, and the
   per-target equivalents) emits `#<${authority} ::${name}>` — `#<::Name>` when
   authority is empty.
3. **Match condition.** The handler arm already passes the param type to the
   match helper; the helper normalizes both sides via `bareName`.
4. **Inbound.** `_bv_from_wire` parses the tag forms.
5. **Translation.** Extend the local-form discriminator to include `:`
   (`browser/brevity.js` and the per-target routing seams).
6. **Tests.** Update every bare-`::Name` tag assertion to the address form:
   `type_wire`, `type_imports`, `type_cross_module`, `scalar_actorization`,
   `structure`, `reference_fields`, `event_cross_module`.

Supersedes the interim `_matchTypes` bare-name patch from the reference-field
work.

## Open / deferred

- **Cross-authority match rejection** → Bluster-layer identity (content hash),
  deferred. v1 matches by name.
- **Anonymous compiles** (no fileName) emit local types as `#<::Name>` and, with
  no translation seam active, they stay `#<::Name>` — correct for same-process.
- **Argument bv-a tags** (a typed value passed as a call *argument*) still emit
  the bare type name (`Point`), not an authority tag — a pre-existing gap
  (args were never `::`-tagged, so they don't reconstruct inbound either).
  Reply slots and typed params carry authority tags; arg slots are a separate
  follow-up.
- **rust/erlang payload translation.** The local-form `:` discriminator was
  added to the browser translation seam only. rust/erlang do not translate
  payload addresses today, so their local type tags stay `#<::Name>` (correct
  same-process); when those targets gain payload translation, mirror the
  `[@#:]` discriminator.

## Shipped (2026-10-26)

Type tags are authority addresses across js/rust/erlang: emission (`tagFor`),
reconstruction (`bv_from_wire` + `bv_type_name`), matching (`type_member_of` by
bare name), cross-module registration (`ctx.typeAuthority`, `crossModuleTypes`
carrying the dep path), and the browser translation `:` discriminator. Tests
updated: type_wire, type_actorization, param_capabilities (×2), event_cross_module.
