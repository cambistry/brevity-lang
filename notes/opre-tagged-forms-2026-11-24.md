# Opre tagged forms: `%` claims addresses, not keys — 2026-11-24

Decided in discussion, not implemented. Supersedes, in `opre-type-encoding-2026-11-21.md`, the
`%`-key forms (`%t`, `%opt`, `%or`, `%fn`, "`%`-prefixed keys are reserved") and the
anonymous shape as an `Object` generic.

## The problem

An entry list, `["Integer", { "k": "Text" }]`, is the Opre form of a set of parameters: positional
items, then named ones in a trailing object. It stands, and needs no wrapper. But it needs
context to say what it is. A function type written `{ "args": […], "re": […] }` can't be told
from named entries called `args` and `re`. Prefixing the keys (`%args`), or a marker key
(`"%fn": true`, as `%t` was), claims names in key position, where every language using Opre
puts its own field and parameter names. Opre would be taking part of their namespace.

## The rule

- **`%` is claimed in address position, not key position.** A type is an address, and the
  address space is Opre's: a token beginning with `%` is quoted, as one beginning with `'` is
  (`'%stupid%address':child`), so an unquoted `%` never starts an address. Keys belong to the
  application; a key may be anything.
- **Wherever a type or an entry list can appear, an array headed by a `%` string is a tagged
  form.** The head says what it is, up front; its operands follow.
- **Inside a tagged form, and in a document's sections (`public`, `protected`, `instance`,
  `types`, `extends`), keys are bare.** What is being read is already known from context.

## The forms

| Form | Encoding |
|---|---|
| function | `["%f", { "args": ["Integer"], "re": ["Text"], "writes": false }]` |
| union | `["%or", "Integer", null]` |
| optional | `["%opt", "Text"]` |
| generic | `["%t", ":Pair", ["Integer", "Text"]]` |
| interface | `["%iface", { "public": … }]` |

- **A function's operands are its signatures,** each exactly as an op's in `public`. More
  than one is an overloaded function: `["%f", sig1, sig2]`, as an op's list is. A silent
  function writes (a silent `->` or `~>` is not legal), so a signature always has a key:
  `() => .` is `["%f", { "writes": true }]`.
- **A generic's parameters are one entry list,** its third item: an Opre object is always
  array-wrapped, named entries trailing inside it. `["%t", ":Tagged", [{ "target": "Text" }]]`.
- **A union's operands are flat.** In a reply, a union of shapes is
  `"re": ["%or", ["Integer"], ["Text"]]`. A one-entry shape is the type alone, so
  `-> Integer | Text` is `"re": ["%or", "Integer", "Text"]`. The flattest form is the encoding.
  An operand that is a plain array is a shape; one that is a type string or tagged form is a
  one-entry shape.
- **An anonymous shape is its entry list:** `(Text, n: Integer)` is
  `["Text", { "n": "Integer" }]`. An entry list already is an Object; it takes no `%t`.
- **`%iface` is an embedded interface,** a service document's node as a value. It gives an
  inline interface `{ … }` an encoding, but an interface in a published signature stays a
  compile error until something needs it.
- **The wire's `ty` is unchanged.** Its positional items are always tag strings, never
  objects, so its trailing named object is never ambiguous.

## Left over

- **`%names`** (a declared type's positional field names) is the one key still `%`-prefixed.
  It goes when positional fields lose their names: they are read by positional destructuring,
  as any Object's are.
- **"Any number of" is retired.** A plain array among a generic's parameters stood for zero
  or more (`List of Integer` was `[["Integer"], { "%t": "List" }]`); a plain array in an entry
  list is now an anonymous shape. A List's parameter is its element type,
  `["%t", "List", ["Integer"]]`: holding any number is what a List is. A variadic run in an
  entry list would need its own tag (`["%many", "Text"]`), when something has one.
- **Open: several List parameters as an implicit union,** `["%t", "List", ["Integer", "Text"]]`
  for a List of Integers and Texts. Against it: the same shape as `["%t", ":Pair", ["Integer",
  "Text"]]`, two slots, so a reader tells "either" from "both" only by knowing the generic.
  The explicit form, `["%t", "List", [["%or", "Integer", "Text"]]]`, costs one tag.
