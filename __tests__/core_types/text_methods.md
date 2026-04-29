# Text Methods

LLM orientation: this document summarizes methods tested in
`text_methods.test.js`. Text methods operate on Unicode scalar positions.

## Forms

```brevity
@upper = -> result: Text.upper("hello")

@upperRef = {
  t Text! = "hello"
  -> result: t.upper
}

@upperBang = {
  t Text! = "hello"
  t.upper!
  -> result: t
}
```

## Case and Whitespace

- `Text.upper(text)` -> `Text`
- `Text.lower(text)` -> `Text`
- `Text.trim(text)` -> `Text`
- `Text.trim_start(text)` -> `Text`
- `Text.trim_end(text)` -> `Text`

Bang forms are tested for these families, for example `t.upper!` and
`t.trim_start!`.

## Position and Slicing

- `Text.size(text)` -> `Integer`
- `Text.first(text)` -> `Text`
- `Text.last(text)` -> `Text`
- `Text.at(text, index)` -> `Text`
- `Text.slice(text, start)` -> `Text`
- `Text.slice(text, start, end)` -> `Text`

Empty `first` returns empty text. Emoji examples are scalar-indexed:

```brevity
Text.at("a\u{1F600}b", 1)
```

returns the emoji as one `Text` value.

## Search and Predicates

- `Text.empty?(text)` -> `Boolean`
- `Text.contains(text, pattern)` -> `Boolean`
- `Text.starts_with(text, pattern)` -> `Boolean`
- `Text.ends_with(text, pattern)` -> `Boolean`
- `Text.index_of(text, pattern)` -> `Integer`

`index_of` returns `-1` when there is no match.

Patterns can be text literals or regex literals:

```brevity
Text.contains("hello 123", /\d+/)
```

## Prefix, Suffix, Replacement

- `Text.before(text, pattern)` -> `Text`
- `Text.after(text, pattern)` -> `Text`
- `Text.replace(text, pattern, replacement)` -> `Text`
- `Text.replace_first(text, pattern, replacement)` -> `Text`

No-match behavior:

- `before` returns the whole text.
- `after` returns empty text.

Regex patterns are tested for `contains`, `index_of`, `replace`,
`replace_first`, `starts_with`, `ends_with`, `before`, and `after`.

## Transform and Combine

- `Text.reverse(text)` -> `Text`
- `Text.repeat(text, count)` -> `Text`
- `Text.concat(a, b)` -> `Text`
- `t.append!(suffix)` mutates a `Text!` ref.
- `t.concat!(suffix)` mutates a `Text!` ref.

`reverse` is scalar-level:

```brevity
Text.reverse("a\u{1F600}b")
```

returns `b`, then the emoji, then `a`.

## Mutating Text Refs

The tested bang methods mutate a `Text!` receiver and return through the ref
when the handler returns that ref:

- `upper!`, `lower!`
- `trim!`, `trim_start!`, `trim_end!`
- `reverse!`, `repeat!(count)`
- `slice!(start, end)`
- `before!(pattern)`, `after!(pattern)`
- `replace!(pattern, replacement)`, `replace_first!(pattern, replacement)`
- `concat!(suffix)`, `append!(suffix)`
