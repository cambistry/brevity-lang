# Values and Actors

Every Brevity runtime entity is either a **value** or an **actor**. This is the
core runtime axis. Most other distinctions in Brevity — what passes by copy,
what has an address, what gets a mailbox, what can hold mutable state, what
crosses the wire as-is — fall out of which side of this line a thing sits on.

## The Two Categories

|  | value | actor |
|---|---|---|
| Created by | type constructor | class constructor |
| Carries | content | identity |
| Passed by | value (copy) | reference (address) |
| Address | none | yes |
| Mailbox | none | yes |
| Mutability | immutable | mutable (via cells) |
| On the wire | as-is (object or scalar form) | as address |
| Examples | `5`, `"hello"`, `Point(1, 2)`, `[1, 2, 3]` | `Counter("start")`, `*Point(1, 2)`, `*Integer(0)` |

A value *is* its content. Two values with the same content are
indistinguishable. An actor *has* identity. Two actors with the same starting
state are still distinct because they have different addresses.

## Source-Level Constructors

The split is visible at the source level. Brevity has two kinds of constructor.

A **type** constructs values:

```brevity
::Point = (x Integer, y Integer)

p = Point(1, 2)
```

`Point` here is a type. Calling it produces a value — a shaped datum, immutable,
addressless. Passing `p` to another function passes its content.

A **class** constructs actors:

```brevity
Counter = *(start Integer) {
  count *Integer = start

  @inc = {
    count <- count + 1
    -> value: count
  }

  @get = -> value: count
}

c = Counter(0)
```

`Counter` here is a class. Calling it produces an actor — addressable,
mailboxed, capable of holding mutable cells. Passing `c` to another function
passes its address, not a copy.

The two declaration forms are distinguished by their prefix:

- `::Name = (...)` is a type declaration. No `*`.
- `Name = *(params) { ... }` is a class declaration. The leading `*` marks the
  form as actor-producing.

## The `*` Prefix Sigil

`*` is the universal "actorize" sigil. It promotes a value-side construct to an
actor-side one. It appears in several positions, all consistent:

**On a class declaration**, marking the form as actor-producing:

```brevity
Counter = *(start Integer) {
  ...
}
```

**On a type at a binding position**, promoting the value to an actor cell:

```brevity
count *Integer = 0
```

This declares `count` as a mutable Integer-shaped actor cell, not a plain
Integer value.

**On a constructor call**, producing an actor instead of a value:

```brevity
p = Point(1, 2)        // value
a = *Point(1, 2)       // actor with Point-shape
```

**On a parameter position**, declaring write capability for a passed cell:

```brevity
inc = (target *Integer) { target <- target + 1 }
```

The receiving function expects an actor cell, not a plain Integer value.

The mental rule: where you can have a value, prefix `*` gives you an actor with
the same shape. Same primitive type or shape; different runtime identity model.

## Mutability

Values are immutable. There is no way to mutate `5`, or `Point(1, 2)`, or
`[1, 2, 3]`. Rebinding a name is not mutation — it is a new binding.

Mutation lives on the actor side. A `*Integer` cell can be written to with the
`<-` operator. An actor's state is the collection of its cells.

```brevity
count *Integer = 0
count <- count + 1
```

`count` is an actor cell. The `<-` writes a new value into the cell. The cell's
identity is preserved; only its content changes.

## Passing Values vs. Passing Actors

Inside one actor, both values and actor references are just bindings. Across
actor boundaries — including handler boundaries between actors — the difference
becomes load-bearing:

- A value is **serialized and copied**. The receiver gets independent content.
- An actor is **passed as an address**. The receiver can send messages to the
  same actor the sender was holding.

On the wire (CAM messages), this distinction is direct:

- Values appear inline in `op`, `re`, and `bv-a` payloads.
- Actors appear as address tokens (`#<Type/id>` style).

This is why `Point` and `*Point` are not just two ways to spell the same thing.
They produce different wire behaviors and different sharing semantics.

## Why The Distinction Matters

A lot of language-level questions collapse to "is this a value or an actor?"

- Can I share it across the wire? Values: by copy. Actors: by address.
- Can I mutate it? Values: never. Actors: through cells.
- Does it have a mailbox? Values: no. Actors: yes.
- Can I subscribe to it? Values: not on their own. Actors: yes.
- Does identity matter? Values: no, content is identity. Actors: yes, address
  is identity.
- Can I capture and replay its state? Values: trivially. Actors: through the
  marshal protocol.

Keeping the two clearly separated is what lets Brevity present one model
locally and remotely. A typed call to `Store.get(...)` is a message to an actor
regardless of where `Store` runs; a `Point(1, 2)` is a value regardless of
where it appears.

## What This Replaces

Earlier prose used "instance" as a softer synonym for actor and "object" as a
loose term covering both shaped data and runtime entities. Both are gone:

- "Instance" is replaced by "actor." Every class-constructed runtime entity is
  an actor. There is no leftover role for "instance."
- "Object" no longer names a runtime category. Shaped data is a value; an
  identity that receives messages is an actor.

The verb form is **construct** (not "instantiate"). The noun for the act is
**construction**. A class *constructs* an actor; a type *constructs* a value.

## Related Reading

- [CAM](./CAM.md) — the message and context model that actors live in
- [Language Overview](../LANGUAGE_OVERVIEW.md) — source-level shape, including
  classes, types, and cells
- [Syntax Crib](./SYNTAX_CRIB.md) — compact pattern sheet
