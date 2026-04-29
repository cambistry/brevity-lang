# List Methods

LLM orientation: this document summarizes methods tested in
`list_methods.test.js`. List methods operate on list elements and preserve typed
list shapes where the result is still a list.

## Forms

```brevity
@size = -> result: List.size([1, 2, 3])

@firstRef = {
  ns List of Integers! = [42]
  -> result: ns.first
}

@reverseBang = {
  ns List of Integers! = [1, 2, 3]
  ns.reverse!
  -> result: ns
}
```

## Meta and Index

- `List.size(list)` -> `Integer`
- `List.empty?(list)` -> `Boolean`
- `List.first(list)` -> element
- `List.last(list)` -> element
- `List.at(list, index)` -> element or `null`

Out-of-range `at` returns `null`.

## Slicing

- `List.slice(list, start)` -> `List`
- `List.slice(list, start, end)` -> `List`
- `List.take(list, count)` -> `List`
- `List.from(list, start)` -> `List`

Out-of-range slicing clamps. `take(0)` returns an empty list. `from(0)` returns
the whole list.

Bang forms mutate list refs:

```brevity
ns List of Integers! = [1, 2, 3, 4, 5]
ns.take!(2)
```

## Search and Boundary

- `List.contains(list, value)` -> `Boolean`
- `List.index_of(list, value)` -> `Integer`
- `List.starts_with(list, prefix)` -> `Boolean`
- `List.ends_with(list, suffix)` -> `Boolean`
- `List.before(list, value)` -> `List`
- `List.after(list, value)` -> `List`

`index_of` returns `-1` on miss. `before` returns the whole list on miss.
`after` returns an empty list on miss.

## Transform

- `List.reverse(list)` -> `List`
- `List.repeat(list, count)` -> `List`
- `List.replace(list, target, replacement)` -> `List`
- `List.replace_first(list, target, replacement)` -> `List`
- `List.flatten(list)` -> `List`
- `List.unique(list)` -> `List`
- `List.sort(list)` -> `List`

Bang forms are tested for reverse, repeat, replace, slice, take, from, concat,
append, prepend, and sort.

## Combine

- `List.concat(list, list, ...)` -> `List`
- `List.append(list, element)` -> `List`
- `List.prepend(list, element)` -> `List`
- `list + list` -> `List`

`concat` accepts two or more lists and folds left-to-right. `append` and
`prepend` add a single element.

## Text Join

```brevity
List.join(["a", "b", "c"], "-")
```

returns `Text`.

## Equality

Search and replacement use Brevity value equality:

- decimals compare by value
- nested lists compare structurally
- primitive values compare by value

## Mutating List Refs

The tested bang methods mutate a `List ...!` receiver:

- `slice!(start, end)`, `take!(count)`, `from!(start)`
- `reverse!`, `repeat!(count)`
- `replace!(target, replacement)`
- `concat!(list, ...)`
- `append!(element)`, `prepend!(element)`
- `sort!`
