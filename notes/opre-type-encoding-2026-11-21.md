# The Opre service document and type encoding — 2026-11-21

Decided in discussion. Retires the Brevity-style
service doc text of `session-2026-10-29-service-doc-notation.md` as a published format.

## Decisions

- **A service publishes a JSON document.** It is written for a consumer in any language: what
  can be sent to each address, with what arguments, and what comes back. Nothing in it is
  Brevity notation.
- **The same encoding is the compiler's internal representation of a type.** The parser turns
  Brevity's type notation into it once, and every later stage reads it. Nothing re-parses a
  type string. Brevity text in, Opre values out.
- **Brevity doesn't change, and the wire doesn't change.** A message's `ty` stays as it is.
- **Exhaustive and explicit.** The document lists every op at every address, including the
  ones a language would imply (a cell's `$get` and `$set`).
- **Out of scope:** JSON-oriented type names (`String` for `Text`). Names stay as they are.

## The document

A tree of addresses. Each node lists the ops it takes (`public` and `protected`) and the
types it declares, and holds its nested addresses under keys with a leading colon. The top
node is the service itself.

```json
{
  "public": {
    "val":  [{ "re": ["Integer"], "writes": false }],
    "cell": [{ "re": ["Text"], "writes": false }],
    "origin": [{ "re": [":Point"], "writes": false }],
    "log.": [{ "args": ["Text", { "%opt": "Boolean" }], "writes": false }],
    "bump!": [{ "re": ["Integer"], "writes": true }],
    "fetch": [{ "re": ["Integer"] }],
    "note.": [{ "args": ["Text"], "writes": "untracked" }]
  },
  "types": {
    ":Point": ["Integer", { "y": "Integer" }]
  },
  ":cell": {
    "public": {
      "$get": [{ "re": ["Text"], "writes": false }],
      "$set": [{ "args": ["Text"], "writes": true }]
    }
  },
  ":G": {
    "public": {
      "$new": [{ "re": [":G:*"], "writes": false }]
    },
    ":*": {
      "protected": {
        "~step": [{ "re": ["Integer"], "writes": false }]
      }
    }
  },
  ":T": {
    "extends": [":G"],
    "public": {
      "$new": [{ "args": ["Text"], "re": [":T:*"], "writes": false }]
    },
    ":*": {
      "public": {
        "get": [{ "re": ["Integer"], "writes": false }]
      },
      "protected": {
        "~step": [{ "re": ["Integer"], "writes": false }]
      }
    }
  }
}
```

- **`public` ops are for any caller. `protected` ops are for an extender:** what `$extend` may
  name and a delegated call may reach. Protection is an Opre concern, so the section says it.
- **An op's key is its exact wire name:** `val`, `log.`, `~step`, `$new`. The document gives a
  name's characters no meaning: `~step` is protected because of the section it is in.
- **An op's value is a list of signatures,** one per overload.
- **A signature has `args` and `re`,** each a list written as `ty` writes it: positional
  entries are items, named entries sit in an object (`["Integer", { "y": "Integer" }]`).
  - `args` is omitted when the op takes none.
  - `re` is omitted when the op never replies. `"re": []` is a reply carrying nothing. A
    cell's `$set` doesn't reply, so it has no `re`.
- **`writes` says whether the op changes state,** which tells a caller whether a call is safe
  to repeat.
  - `false`: it doesn't.
  - `true`: it does.
  - `"untracked"`: it does, in a way its service declares doesn't count (a log, a counter).
    A caller may treat it as not writing.
  - Omitted: no claim either way.
- **`extends` lists a class's parents,** in order, each an address. It sits on the class's
  node, beside `public`. A parent in another service is its address as this service reaches
  it.
- **A node key with a leading colon is an address under that node,** as on the wire: `":cell"`
  under the service is `:cell`. Nodes nest to any depth.
- **`":*"` is every instance under a node:** `:T:1`, `:T:2`, and so on.
- **`types`** are a node's declared shapes, each an entry list like `args`. A type's key has
  the leading colon too (`":Point"`), so it reads the same where it is declared and where it
  is used.

What the source constructs come to:

- **A constant** (`@val = 100`) is an op of its name that replies with its value.
- **A cell** is three entries: an op of its name on its owner, and `$get` and `$set` at its own
  address.
- **A class** is an address with a `$new` op. The reply is an instance, whose interface is the
  `":*"` node under it. The class's other ops (its class block's) sit beside `$new`.

## Types

- **A type is an address,** a string. `"Integer"` is the type the service's parent defines
  under that name, `":Point"` is the service's own, and `"svc:Point"` is one from another
  service. Nothing separates a type's name from an address: every string in a type position is
  an address.
- **Optional is a one-key wrapper:** `{ "%opt": "Boolean" }`. It wraps any type, a generic
  included, positional or named (`{ "opts": { "%opt": "Object" } }`).
- **An address the document has a node for is typed by that node's ops:** `":T:*"` is an
  instance of `T`. (The wire's tag for an instance stays `:T`.)
- **A generic is a list of its parameters, ending in a `%t` entry naming it.** Named parameters
  go in the `%t` entry.

  ```json
  [["Integer"], { "%t": "List" }]
  ["Integer", "Text", { "%t": "Pair" }]
  [{ "target": "Text", "%t": "Tagged" }]
  ```

- **A nested list is "any number of":** `["Integer"]` among a generic's parameters stands for
  zero or more Integers. `["Integer", ["Text"], { "%t": "Tuple" }]` is an Integer, then any
  number of Texts.
- **`%`-prefixed keys are reserved.** `%t` and `%opt` are provisional spellings.

Decided 2026-11-22, for the forms the note above leaves open:

- **A union is `{ "%or": [A, B] }`.** The `null` of `X | null` is JSON `null`:
  `{ "%or": ["Integer", null] }`.
- **A function type is `{ "%fn": [signature] }`,** the signature exactly as an op's: `args`,
  `re`, `writes`. `->` is `"writes": false`, `=>` is `true`, `~>` makes no claim. A silent
  `=> .` has no `re`.
- **A reply that is the receiver is `{ "%self": true }`:** `=> self` is `"re": [{ "%self": true }]`.
- **A reply that depends on the path is a union of shapes:** `-> (Integer) | (Text) | self` is
  `"re": { "%or": [["Integer"], ["Text"], [{ "%self": true }]] }`.
- **No inline nodes.** An interface `{ … }` and a constructor profile `(p) -> *{ … }` claim a
  dependency's shape, after `as`; neither has an encoding, and one in a published signature is a
  compile error. (An earlier `{ "%node": { … } }` wrapper is dropped, 2026-11-22: no service
  document used it.) A cell (`*Integer`, `&Integer`) encodes as its type for now; how a cell
  is typed is open.
- **An anonymous shape is an `Object`:** `(Text, n: Integer)` is
  `["Text", { "n": "Integer", "%t": "Object" }]`.
- **Named entries sit in one object after the positional ones,** as `ty` writes them.
- **A declared type's positional fields keep their names, as `%names`** in the object of its
  named entries, in order: `type Point (x Integer, y: Integer)` is
  `":Point": ["Integer", { "y": "Integer", "%names": ["x"] }]`. A caller reads a positional field
  by name (`p.x`), and decodes a value into its fields, so the names are part of the type's
  interface, unlike a positional param's.
- **A service's `as` clauses are its `$as` op,** one signature per type it converts to: `$as`
  takes the type and replies the value as it, so each signature is `{ "re": [T], "writes": false }`,
  its arg the type of its reply.

## Addresses

- **Every address in the document is relative to the service,** in standard Opre form: a
  leading colon is the service itself, so `":cell"`, `":Point"` and `":T:*"` are its own, and
  anything else (`"Integer"`, `"svc:T"`) is an address as the service reaches it.
- **Addresses appear only as string values,** never as keys: in `args`, `re`, `extends`, a
  generic's parameters and its `%t`. A node's key is its place in the tree, not an address to
  translate.
- **The document translates like any Opre value.** As it passes from one perspective to
  another, each address in it is rewritten by the usual rule, as a `ty` tag's is.
