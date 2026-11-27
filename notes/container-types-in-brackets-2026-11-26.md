# Container types in brackets (2026-11-26)

Supersedes the `X of Ys` spelling (`List of Integers`, `Lists of Texts`, `Signed of Point`; notes/session-2026-03-07.md and earlier).

## Decision

A container type is `X[Y]`, for any container:

```brevity
xs List[Integer] = [1, 2]
grid List[List[Integer]] = [[1], [2, 3]]
maybe List[Integer | null] = [1, null]
@check = (r Signed[Request]) -> …
```

- The element is always written singular: `List[Point]`, `List[Integer]`. Plurals (`Integers`, `Lists`, …) are not type names.
- `of` is not a keyword.
- The `[` follows the name unspaced. `List [Integer]` is not a type.
- Bare `List` is `List[Anything]`.
- The brackets hold a whole type, so a union inside is unambiguous: `List[Integer | null]` is a list of maybe-Integers; `List[Integer] | null` is a maybe-list.
- Errors and service documents print the same spelling.

## Reasons

- The plural rule was uneven: required for six built-ins, refused for declared types (`List of Points` failed), optional for `Decimal`.
- The bracket form is shorter and nests visibly.

## Encoding

Unchanged for lists: `List[Integer]` is `[['Integer'], {'%t': 'List'}]`. A container is `[param, {'%t': X}]` with `param` its element's type, wrapped `[…]` only for `List` (a list holds any number of its element). So `Signed[Integer]` is `['Integer', {'%t': 'Signed'}]`, and the old "many" reading, `Signed of Integers`, is written `Signed[List[Integer]]`: `[[['Integer'], {'%t': 'List'}], {'%t': 'Signed'}]`.
