# Vocabulary refactor — Class, Actor, Object, Value (2026-05-15)

Status: **decided**, with one item (item 4) flagged as leaning rather than committed. Affects user-facing terminology across docs, prose, and source comments. AST identifiers exempted per the rule from `service-block-terminology-2026-04-16.md`.

## Motivation

The Type/Class split (`type-class-split-2026-04-25.md`) committed to "Class" as the source-level word for named actor constructors. That concession dragged residual OOP vocabulary into the project: "instance," "constructor" as a noun, "service block" as a Brevity-special term where a more familiar word was available, and "Structure" naming a primitive the CAM docs already referred to informally as a JS object.

This note resolves that residual vocabulary into a closed, non-redundant set. Each word does one job; the source/runtime and value/actor axes are both named honestly. The OOP-on-top-of-CAM framing renders directly into the vocabulary: **classes construct actors; types construct values; actors exchange objects; interfaces describe the surfaces actors expose**.

## Decisions

### 1. Drop "instance" as a runtime word.

A class-constructed thing is an **actor**, not an "instance." "Instance" was doing softener work — it implied something gentler than the actor model commits to (addressable, mailboxed, message-passing). Every class-constructed runtime entity is an actor; there is no leftover role for "instance" to fill.

The verb "instantiate" is replaced by **construct**. "Instantiation" as a noun-phase becomes "construction."

### 2. Drop "constructor" as a noun for the class.

Calling the class "the constructor" invited a Java/JS misread: in those languages, a constructor is a *method inside* a class. Brevity's class *is* the construct-thing; there is no separate constructor method.

Renames:
- "named actor constructor" → **class**
- "constructor header" → **class header**
- "constructor signature" → **class signature**
- "constructor bindings" (DI) → **class bindings**
- "constructor expression" (inline anonymous form) → **class expression**

The verb **construct** is unchanged. "Calling a class constructs an actor."

### 3. Rename "service block" → "constructor block".

Frees "service" from terminology work and gives the trailing block the familiar OOP-shaped name. In JS/TS, `constructor` names the code that runs when you construct an instance — Brevity's constructor block fills the same role (declares the state cells, handlers, and projections that come into being when the class is constructed). Same word, same role, different mechanism.

Updates the user-facing name from `service-block-terminology-2026-04-16.md`. The 04-16 note rejected "init block" because init happens in the header; that argument doesn't transfer to "constructor block" because construction is broader than init and continues into the block. The block IS where user-written construction code lives.

"Service" retreats to informal English usage ("the Counter service handles these messages") without doing terminology work.

AST identifier `constructorBody` was already correctly named and stays per the 04-16 internal-identifiers carve-out.

### 4. Deprecate the empty/missing constructor block (lean, not yet committed).

A class with no constructor block has no handlers, no state cells, no projections — an actor that responds to nothing. The role that form used to fill (typed-shape-with-auto-accessors) is now Types' job (`::Name = (fields)`).

Lean: a class must have a constructor block. The data-shape role belongs to `::`. The cleaner rule is **class = class header + constructor block**; no implicit/empty form.

Not yet final because a sweep of existing usages may surface a niche case (DI-only wrappers, marker classes) worth preserving. Worth a brief audit before committing.

### 5. Rename "Structure" → "Object".

The CAM doc already described the wire substrate as "vanilla JS objects" and Rust codegen already used `Value::Object`. Naming the primitive **Object** makes the prior informal usage official and claims the concept as Brevity's own (with its own canonicalization, schema, and content-hash properties) rather than borrowing JS's.

Object is the **protocol primitive**: linked-list-backed list of positional and/or named entries. Used for args, replies, and message shapes. Not optimized for indexing — small, walkable, JCS-canonicalizable.

Properties a Brevity Object has that a JS object doesn't:
- JCS-canonicalized for content hashing
- Schema-constrained (a Type describes valid shape)
- By-value on the wire (no shared references across actors)
- Cross-language portable

This means "List" and "Dictionary" are no longer distinct primitives — both are Object-typed. A `List of Integer` is a Type that constrains its Object to be all-positional; a record-shaped Type (`::Person = (name: Text, age: Integer)`) constrains its Object to be all-named. The Type system carries the intent; the data primitive is unified. Object/List remains the **core, central primitive**; Map and Array (next) are additional primitives for specific roles.

### 6. Add "Map" — hash-keyed lookup primitive.

Distinct from Object. Hash-backed, O(1) lookup, **content-keyed** (not reference-keyed like JS Map). Accepts complex non-string keys — the BLAKE3 hash of the key's JCS canonical form determines equivalence, so identical content matches across the wire.

Use case: actual lookup tables where O(1) access matters and keys are non-trivial. Compiles to JS Map / Rust HashMap / Erlang map per target.

The content-equivalence-not-reference-equivalence property is what differentiates Brevity Map from JS Map and makes it useful across the wire boundary. JS Map's `Map.set({a:1}, "x")` can't be looked up by a fresh `{a:1}`; Brevity Map can, because the lookup is by content hash.

### 7. Add "Array" — random-access ordered primitive.

Distinct from Object (linked) and Map (keyed). Contiguous, O(1) indexed access, bulk data. JS-target compiles to JS Array; Rust target to `Vec`; Erlang to whatever fits.

Brevity Array is cleaner than JS Array (no sparse-holes / numeric-keyed-object weirdness), but 90% of how JS devs use Array matches Brevity's semantics. **Vector** was considered as a name (FP-family precedent: Clojure, Scala, Haskell, Rust `Vec`) and is technically more precise — but Array won on consistency-with-JS-familiarity grounds, the same logic that won Object and Map. List remaining the core primitive (Object positional flavor) and Array the random-access variant is the correct distinction; List is more central, Array is supplementary.

### 8. Add "value" — the pass-by-value runtime category.

A **value** is what a Type constructor produces. Pass-by-value semantics: immutable, wire-portable, no address, no mailbox. Includes scalars (`Integer`, `Text`) and Objects/Lists/Maps/Arrays (compound Type values).

An **actor** is what a class constructor produces. Pass-by-reference (by address) semantics: addressable, mailboxed, possibly stateful.

These are the two runtime categories. Every Brevity runtime entity is either a value or an actor. The axis is "carries content" vs "carries identity."

Prefix `*` promotes a value to an actor: `Point(1, 2)` is a value; `*Point(1, 2)` is an actor with the same shape but actor semantics (address, mutability via cells). Same for scalars: `x = *Integer(0)` is a mutable Integer cell. The `*` is the universal "actorize / make instantiable" sigil — same sigil used at the head of a class declaration (`C = *(params) { constructor block }`), where it marks the whole form as an actor-producing constructor. Postfix `!` for actorization is deprecated per `capability-sigils-2026-05-06.md`.

## Final vocabulary

| Term | Role | Register |
|---|---|---|
| **Class** | Source artifact: class header + constructor block | source |
| **Class header** | The `*(...)` part: params, DI, inheritance (prefix `*` marks the form as actor-producing) | source |
| **Constructor block** | The `{...}` part: state cells, handlers, projections | source |
| **Type** | Homeless portable shape (`::Name = (...)`) | source |
| **Interface** | Message-surface shape | source |
| **Construct** | Verb. Class + args → actor; Type + args → value | verb |
| **Actor** | Runtime entity: addressable, mailboxed | runtime |
| **Value** | Runtime datum: pass-by-value, no address | runtime |
| **Object** | Protocol primitive: linked-list of entries, args/replies | data primitive |
| **Map** | Lookup primitive: hash-keyed, content-keyed, complex keys | data primitive |
| **Array** | Bulk primitive: random-access, contiguous | data primitive |

## The two axes

### Source → Runtime

- A *class* (source) constructs an *actor* (runtime).
- A *type* (source) constructs a *value* (runtime).
- An *interface* (source) describes the message surface of an *actor*.

### Value vs Actor (the runtime axis)

|  | value | actor |
|---|---|---|
| Created by | Type constructor | class constructor |
| Carries | content | identity |
| Passed by | value (copy) | reference (address) |
| Address | none | yes |
| Mailbox | none | yes |
| Mutability | immutable | mutable (via cells) |
| On the wire | as-is (Object/scalar form) | as address |
| Examples | `5`, `Point(1, 2)`, `[1,2,3]` | `Counter("start")`, `*Point(1, 2)`, `*Integer(0)` |

## What this updates

- `service-block-terminology-2026-04-16.md` — user-facing name changes to "constructor block." Internal AST identifiers (`constructorBody`, `initBody`, `initParams`) unchanged per the 04-16 carve-out.
- `type-class-split-2026-04-25.md` — "named actor constructor" phrasing throughout is now just "class." The decisions in that note are otherwise intact.
- `concepts/cam-actor-model.md` — "vanilla JS objects" should become "Objects" (Brevity's primitive). The CAM doc's "Actors are not objects" framing was written before the class concession; under the new vocab, actors are not values, which is the more accurate axis to draw.
- `concepts/brevity-language.md` — references to "Types in Brevity are not OOP objects" predate the Type/Class split; the type system section needs alignment with the post-split, post-rename vocabulary.

## What stays

- Prefix `*` is the actorize sigil (value → actor), per `capability-sigils-2026-05-06.md`. Used at the type position (`*Integer(0)`, `*Point(1, 2)`) and at the head of a class declaration (`C = *(params) { constructor block }`). Postfix `!` for actorization was already deprecated in the 05-06 note; this refactor leans into the prefix-`*` convention rather than reviving it.
- `::` unchanged: type declaration / cross-module type reference.
- The Class/Type/Interface three-kinds distinction from `capability-sigils-2026-05-06.md` unchanged.
- AST field names (`constructorBody`, `initBody`, etc.) unchanged.
- Verb "construct," noun "construction" — these stay; only the noun "constructor" (as a name for the class) goes away.

## Open

- **Item 4 audit**: confirm no existing usage of empty constructor blocks before committing the deprecation.
- **Hybrid Objects** (mixed positional + named entries): allowed syntactically; idiomatic uses are positional-only or named-only.
- **Vector as a future primitive name**: if a separate FP-style immutable persistent vector type ever needs a home, Vector is available. Array fills the random-access role for v1.
- **Doc/prose sweep**: a one-time backport pass through `notes/`, `concepts/`, `syntax/`, and source comments to apply the new vocabulary, similar in shape to the service-block sweep of 2026-04-16.
