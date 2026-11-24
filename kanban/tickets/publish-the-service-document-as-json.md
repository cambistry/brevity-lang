---
status: done
created: 2026-11-22
---
# Publish the service document as JSON

`extract(source).interface` gains the JSON document described in notes/opre-type-encoding-2026-11-21.md ("The document"), built with the encoder from ticket 1. The existing doc text stays for now.

- A tree of addresses. Each node has `public`, `protected` and `types`, with nested addresses under colon-prefixed keys.
- An op's key is its exact wire name. Its value is always a list of signatures.
- A signature has `args` (omitted if none), `re` (omitted if the op never replies) and `writes`: false, true, "untracked", or omitted for no claim.
- A constant is one op. A cell is three entries: its name as an op on its owner, and $get and $set at its own address. $set has no `re`.
- A class is a node with a $new op replying ":T:*", its class block's ops beside $new, its instances' interface under ":*", and `extends` listing its parents as addresses.
- Declared types are keyed with a leading colon (":Point").

Done when: tests compare the whole JSON document to a literal for a file with constants, cells, protected names, overloads, a type, a class with a class block, a subclass, and each `writes` value.
