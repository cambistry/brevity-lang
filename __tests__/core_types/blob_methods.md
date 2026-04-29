# Blob Methods

LLM orientation: this document summarizes methods tested in
`blob_methods.test.js`. Blob methods are byte-level operations.

## Forms

```brevity
@slice = -> result: Blob.slice("hello", 1, 3)

@sliceRef = {
  b Blob! = "abcde"
  -> result: b.slice(0, 2)
}

@reverseBang = {
  b Blob! = "hello"
  b.reverse!
  -> result: b
}
```

## Byte Position and Slicing

- `Blob.size(blob)` -> `Integer`
- `Blob.empty?(blob)` -> `Boolean`
- `Blob.first(blob)` -> `Blob`
- `Blob.last(blob)` -> `Blob`
- `Blob.at(blob, index)` -> `Integer`
- `Blob.slice(blob, start)` -> `Blob`
- `Blob.slice(blob, start, end)` -> `Blob`

`Blob.at("hello", 0)` returns the byte value `104`.

## Search and Boundary

- `Blob.contains(blob, pattern)` -> `Boolean`
- `Blob.starts_with(blob, pattern)` -> `Boolean`
- `Blob.ends_with(blob, pattern)` -> `Boolean`
- `Blob.index_of(blob, pattern)` -> `Integer`
- `Blob.before(blob, pattern)` -> `Blob`
- `Blob.after(blob, pattern)` -> `Blob`

`index_of` returns `-1` on miss. `before` returns the whole blob on miss.
`after` returns an empty blob on miss.

Patterns can be blob/text literals or regex literals. Regex matching is
byte-level.

## Transform and Combine

- `Blob.reverse(blob)` -> `Blob`
- `Blob.repeat(blob, count)` -> `Blob`
- `Blob.trim(blob)` -> `Blob`
- `Blob.trim_start(blob)` -> `Blob`
- `Blob.trim_end(blob)` -> `Blob`
- `Blob.replace(blob, pattern, replacement)` -> `Blob`
- `Blob.replace_first(blob, pattern, replacement)` -> `Blob`
- `Blob.concat(a, b)` -> `Blob`
- `b.append!(suffix)` mutates a `Blob!` ref

Bang forms are tested for reverse, slice, replace, trim, and append.

## Encodings and Crypto Helpers

- `Blob.zeros(count)` -> `Blob`
- `Blob.to_hex(blob)` -> `Text`
- `Blob.from_hex(text)` -> `Blob`
- `Blob.to_base64(blob)` -> `Text`
- `Blob.from_base64(text)` -> `Blob`
- `Blob.to_utf8(blob)` -> `Text`
- `Blob.from_utf8(text)` -> `Blob`
- `Blob.xor(a, b)` -> `Blob`
- `Blob.constant_time_equals(a, b)` -> `Boolean`

## Blob vs Text

Blob size is byte count. Text size is scalar count.

```brevity
Blob.size("\u{1F600}")  -- 4
Text.size("\u{1F600}")  -- 1
```
