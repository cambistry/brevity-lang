---
status: inbox
created: 2026-11-02
---
# change "bv-a" to "ts" (types)

Instead, let the type names themselves carry the language and version specification.

It is also probably unnecessary to wrap “ts” types in address brackets, since the entire “ts” payload is always transformed in transit.

{ re: [123], ts: [“Brevity::Integer“] }

or

{ re: [123], ts: [“BV1::Integer“] } – if schema versioning in play

One could think of Brevity itself, even inside of a Brevity program, as an actor/factory that instantiates scalar types, living at the address “Brevity”.

If there is no language type schema versioning, then types must remain backward compatible. This might not be as onerous as it seems, since the contract here for a scalar type is primarily (or maybe exclusively) about how the data is represented in JSON. As long as actorization doesn’t auto-provision mutation methods beyond `set`, this is a bounded contract.
