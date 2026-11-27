---
created: 2026-11-15
---
# retire `List of Integers` and such? Feels out of step with the language and its syntactic needs

**Decided (2026-11-26):** a container type is `X[Y]`, for any container: `List[Integer]`, `List[List[Integer]]`, `List[Point]`, `Signed[Point]`. The element is always singular; the plurals (`Integers`, `Lists`, …) are not type names, and `of` is not a keyword. Bare `List` is `List[Anything]`. Errors and service docs print the new spelling; the wire encoding is unchanged.
