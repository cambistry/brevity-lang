# CAM naming, dialect layering, and type-shadow standardization

**Date:** 2026-05-15
**Status:** design note. No code changes. Captures a working session on what "CAM" is, what it isn't, and how dialects layer on top.

## What CAM is (core)

CAM = **Coordinate Actor Messaging**. "Messaging" over "Model" — the core is a wire contract, not a computational model. Saving "Model" for the broader system that *uses* CAM keeps both names honest.

Core CAM is four things and nothing more:

- Actor communication
- JSON-serializable messages
- `from` and `to` fields
- Interior addresses begin with a delimiter; external addresses do not

That's it. No type system, no `id`, no `op`, no `re`. Operational fields are a *dialect on top of CAM*, not part of CAM.

## Dialect identification: the `cam` field

`{"cam": "<dialect>", ...}` declares which dialect a message uses.

- **Optional.** Absence means bare CAM (just `to`/`from`). Routers don't need to inspect it.
- **Self-naming.** The key literally announces "this is a CAM message"; the value names the dialect. A reader outside the system sees both pieces in one field.
- **Discoverable.** Unlike `$` (which has no canonical meaning despite the JSON-Schema/`$type` family), `"cam"` is googleable and points to the spec.
- **No collisions.** No JSON spec reserves bare `"cam"`.

Rejected alternatives: `$`, `$schema`, `$type`, `proto`. `$schema` was the runner-up but borrows authority from a use it wasn't designed for.

## Dialect naming: drop the `cam-` prefix

The operational dialect (currently expressed via `id`, `op`, `re`, `ex`) gets a name. Constraints:

- Not synonymous with brevity/bv — CAM is polyglot, dialects shouldn't be branded
- Shouldn't claim "pride of place" within CAM (no `cam-1`)

Resolution: **`op-1`**. The substrate field (`cam`) already establishes the namespace, so the value doesn't need to repeat it. Same reason TCP and UDP aren't called `ip-tcp` and `ip-udp`.

```json
{"cam": "op-1", "to": "...", "from": "...", "id": "...", "op": "...", "re": "..."}
```

Considered and rejected:
- `cam-op-1` — redundant with the `cam` key, implies submodule
- `rr-1` (request/response) — overcommits semantically; `op-1` allows fire-and-forget, `re` is *available* not *required*
- `cam-1` — pride-of-place, crowds out sibling dialects

Versioning is inline (`op-1` → `op-2`), not split into a separate field. New version = new identifier. Consumers match on one string.

## Type shadowing

Project already uses `bv-a` as a shadow field paralleling payload shape:

- Args: `"bv-a": [["Integer", "Integer"]]` parallels positional args in `op`
- Returns: `"bv-a": {"coords": "::Point"}` parallels `re`
- Shapes prefixed `::`, scalars bare (`"Integer"`, `"Text"`, etc.)

Open question: should `op-1` reserve a **language-agnostic** type-shadow field (e.g., `tp`) with namespaced types?

```json
{"cam": "op-1", "tp": [["bv:Text"]], "re": {"output": "bv:Decimal"}}
```

Arguments for namespaced types:
- Polyglot: a Python actor and a Rust actor can carry their own type names on the same bus (`py:str`, `rs:String`)
- No collisions across language type systems
- A registry of cross-namespace equivalences keeps the wire compact

Argument against using JSON type names (String/Number/Boolean) as the shadow vocabulary: the numeric tower is the killer case. Integer/Decimal/Float carry real semantic distinctions (exactness, division behavior, precision) that "Number" erases. Decimal often wire-encodes as a JSON *string* anyway, so calling it "String" is wrong twice — wrong wire shape *and* wrong semantics. Pick one paradigm; half-and-half is the worst option.

### Union types for polyglot equivalence

Notation: `"bv:Text | js:String"`. A union is a **claim of cross-namespace equivalence** — useful for receiver hinting when multiple known receivers could consume the message, dangerous when the equivalence is subtly false.

Works cleanly:
- `bv:Text | js:String | py:str` — all reasonably equivalent for UTF-8 text
- `bv:Bool | js:Boolean | py:bool` — exact match

Quietly lies:
- `bv:Decimal | py:Decimal` — Python's `decimal.Decimal` has mutable global precision; `bv:Decimal` is exact-or-error
- Anything where representation matches but semantics drift

The sender writing a union is making a guarantee — should only do so when the named types are isomorphic over the same underlying value.

## Wire format evolution

Moving from bare names (`"Integer"`) to namespaced (`"bv:Integer"`) is a real format change, not a no-op. Options:
- Default namespace: unprefixed = `bv:` for backwards compatibility
- Migration: rewrite all generated messages explicitly

Worth settling alongside the `cam` field, since both changes naturally land together.

## What's still open

- Whether `tp` (or whatever the standardized shadow name is) lives in `op-1` specifically, or is a **cross-dialect convention** that any dialect can opt into. Typed payloads aren't unique to RPC — a pubsub dialect would want them too.
- Generics: `bv:List[bv:Integer]` as in-band string syntax vs. structural (`{"name": "bv:List", "of": "bv:Integer"}`). Brevity has parameterized types, so this *will* come up.
- Whether the default unprefixed namespace makes sense or whether old wire is migrated outright.
- Address semantics around the interior/exterior delimiter — deferred. Principle stands; details later.
