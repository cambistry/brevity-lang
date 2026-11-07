# Session 2026-11-06: `ty` is the type of the value sent

**Rule (user):** `ty` must not contain type unions. Its job is to report on the actual
type of the data, not some theoretical container. The same goes for `Anything`.
Closes "Still open: unions and `Anything`" in `session-2026-11-03-ty-key.md`.

```
before:  x Integer | Text = 42   →  { re: { result: 42 }, ty: { result: 'Integer | Text' } }
after:                            →  { re: { result: 42 }, ty: { result: 'Integer' } }
         p Point | null = Point(1, 2)  →  { re: { result: [1, 2] }, ty: { result: '::Point' } }
```

## How

- **Compile time** (`src/codegen/ty_tags.js`, shared by all targets):
  - `isDynamicTy(t)`: the declared type can't be the tag. That means a union, `Anything`
    anywhere in it, or a bare `List`.
  - `tyMembers(t, tagFor, typeDecls)`: the members as `[kind, tag]` pairs. Tags are
    worked out at compile time, so a type member keeps its authority (`path ::Point`).
    `kind` is what the target's kind function reports (`_bvAsKind`, `bv_as_kind`).
    `*` marks a member with no kind of its own (a class). A union that admits
    `Anything` gets every known type as a member too.
  - `wireTypes(t, typeDecls)`: the types a union slot's value may be. Used to convert
    a union slot's type value to wire form, which never happened before: such values
    went out as `{ __type, x, y }`.
- **Runtime:** `_bvTyOf(v, m)` (JS, `AS_PREAMBLE`), `bv_ty_of(v, m)` (Rust, always
  emitted; Erlang, `PREAMBLE`).
  - Picks the member matching the value's kind. An `Integer` can take a `Float` or
    `Decimal` member; `null` can take a `List` member, since JS's empty list is
    `null`; a `*` member is the last resort.
  - With no match, falls back to the value's own kind. For a list that is each
    element's tag, for a type value `::Name`.
  - Replaces `_List.typesOf`, `list_types_of` and `list_component_types` /
    `brevity_typeof`, which reported `'Anything'` for anything that wasn't a scalar.
- **Where it applies** (all three targets unless noted):
  - reply slots (`genTyBody`, `genRustTyBody`)
  - call-argument and subscribe-argument tags
  - cell notify
  - the remote `set` hint
  - JS only: the test-harness `get` reply (its constructor params used to say
    `'Anything'`) and `as`-clause replies with a union target

## Wire form of union slots

`_bv_to_wire` (JS), `rustTypeWireWrap` and `erlTypeWireWrap` now convert a union
slot's value too. A union value's own `__type` picks the type's fields: the JS runtime
registry looks it up, and Rust and Erlang get a `match` / `case` over `wireTypes`. A
value that isn't a type value passes through unchanged. The Rust re body and the
Erlang reply bodies used to wrap values with their own copies of this code; they now
call the shared wrapper.

## Limits

- **A slot that isn't a name.** A dynamic slot whose value is an expression, not a
  name, gets no `ty`, because re-running the expression for its tag could run its
  effects twice. This is what a `List of Anything` slot with no name already did.
  `-> result: x as Integer | Text` is untagged for this reason.
- **A type value under `Anything` with no matching member** is tagged `::Name` with no
  authority. Only types this file doesn't know reach this point.
- **The JS spread reply** (`_ty_re = _ty[0]`) still sends back the caller's own tag.
- **`_ty_re = 'Class'`** on a bare self-return (`javascript/classes.js`) is not
  touched.

## Tests

- **Expectations changed** to the value's actual type: `types/type_union`,
  `core_types/null`, `keywords/reduce`, `keywords/if`, and `core_types/list`
  (`first: 'Anything'` → `'Integer'`).
- **New** in `types/type_union`: "Unions — ty is the type of the value sent". Covers
  `Point | null` holding a Point (`::Point`, wire form `[1, 2]`), the same slot holding
  `null`, and `List of Integers | null`.
