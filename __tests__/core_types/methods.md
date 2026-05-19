# Core Type Methods

LLM orientation: this is the meta-guide for methods on core collection-like
types such as `Text`, `List`, and `Blob`.

## Method Shapes

Pure type call:

```brevity
result Text = Text.upper("hello")
```

Receiver call on a value or cell:

```brevity
t *Text = "hello"
result Text = t.upper
```

Bang mutator on a cell:

```brevity
t *Text = "hello"
t.upper!
-> result: t
```

Bare helper call is available for some methods:

```brevity
t Text = "hello"
result Text = upper(t)
```

## General Rules

- Pure calls return a new value and leave inputs unchanged.
- Receiver calls without `!` return a value and leave the receiver unchanged.
- Bang calls end in `!`, require a `*Type` cell receiver, and update that cell.
- Bang calls are available for same-family return operations in the tested
  method families: case, trim, reverse, repeat, slice, before, after, replace,
  replace_first, concat, append, and the list-specific mutators.
- Predicate methods end in `?` and return `Boolean`.
- Search methods such as `index_of` return `Integer` and use `-1` for no match.
- `before` returns the prefix before a match; if missing, it returns the whole
  value.
- `after` returns the suffix after a match; if missing, it returns the empty
  value.
- `slice`, `take`, and `from` clamp out-of-range indexes.

## Family Resemblance

`Text`, `Blob`, and `List` intentionally share method names where the operation
has the same broad shape:

- size / empty predicates
- first / last / at
- slice / take / from
- contains / index_of
- starts_with / ends_with
- before / after
- replace / replace_first
- reverse / repeat
- concat / append

The return type stays native to the receiver family. `Text.reverse` returns
`Text`; `Blob.reverse` returns `Blob`; `List.reverse` returns a `List`.

`append` means "add one element or suffix" for the receiver family. `concat`
means "combine values of the same family"; for lists, `+` is tested as a pure
synonym for `List.concat`.

## Value Semantics

`Text` is scalar-indexed. Emoji and other non-ASCII scalar values count as one
text position in tested `Text` methods.

`Blob` is byte-indexed. `Blob.size("\u{1F600}")` returns the UTF-8 byte count,
while `Text.size("\u{1F600}")` returns one scalar.

`List` equality-sensitive methods use Brevity value equality. Decimal values
compare by value, and nested lists compare structurally.

## Method Docs

- [Text Methods](text_methods.md)
- [List Methods](list_methods.md)
- [Blob Methods](blob_methods.md)
