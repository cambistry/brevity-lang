# `^` composes classes and actors — 2026-11-19

Decided. Supersedes `++` as the extends operator (`class-extends-plusplus-2026-11-10.md`)
and the `++ actor { … }` trailing class block (`actor-literal-2026-11-17.md`,
`class-singleton-forms-2026-11-13.md`). `++` has no meaning on classes afterwards.

## The idea

A definition is a stack of layers joined by `^`, read left to right. A layer further right
takes precedence over the layers to its left: where two layers answer the same name, the
right-hand one does. `^` reads as "on top of".

A layer is one of:

| Layer | Spelling | Is |
|---|---|---|
| parent | `T`, `@T` | a class in scope |
| constructor | `*{ … }`, `(params) *{ … }` | the instance body, built by `new` |
| singleton | `{ … }` | an actor literal, built once |
| head singleton | `actor { … }` | a singleton as the first layer only |

```brevity
T = actor { … } ^ *{ … }                 // a singleton, then a constructor over it
V = T ^ U ^ { … } ^ *{ … } ^ { … }        // parents, a singleton, a constructor, a singleton on top
C = A ^ B                                 // two parents; B takes precedence
U = V^                                    // the empty subclass: a new class, no changes
D = T ^ (n Integer) *{ … }                // a parent, then a constructor with params
```

`U = V^` is preferred without the space. It differs in kind from `U = V`, as `V++` did: `V`
alone is an alias (the same class), and `V^` is a new class with its own authority and `ty` tag.

## `actor` is for the head only

Inside a `^` chain, the context already says a `{ … }` layer is a singleton, so it takes no
keyword. `actor` appears only where an actor literal begins a definition:

- a singleton: `s = actor { … }`, `@s = actor { … }`, `actor -> statement`
- the whole-file actor: `actor { … }` at the head of a file
- the first layer of a chain: `T = actor { … } ^ *{ … }`

Elsewhere, `^ actor { … }` included, it doesn't parse. That covers the trailing singleton:

```brevity
T = *{ … } ^ actor { … }    // syntax error
T = *{ … } ^ { … }          // correct
```

(Per the no-detectors rule, it fails as an ordinary parse error, not with a pointer.) `actor` stays a contextual keyword, an
ordinary name everywhere else, as in `actor-literal-2026-11-17.md`.

## What replaces what

| Before | After |
|---|---|
| `D = C ++ (p) *{ … }` | `D = C ^ (p) *{ … }` |
| `D = A ++ B ++ *{ … }` | `D = A ^ B ^ *{ … }` |
| `D = A ++ B` | `D = A ^ B` |
| `D = C++` | `D = C^` |
| `C = (p) *{ … } ++ actor { … }` | `C = (p) *{ … } ^ { … }` |
| — (was refused: the leading form) | `C = actor { … } ^ (p) *{ … }` |
| doc: `Text Node ++ -> *{}` | doc: `Text Node ^ -> *{}` |
| doc: `C A ++ B ++ (c: Integer) -> *{ … }` | doc: `C A ^ B ^ (c: Integer) -> *{ … }` |
| doc: `*{ … } ++ actor { members }` | doc: `*{ … } ^ { members }` |

## Parsing

`^` is also the exponent (right-associative, binding tighter than `*`). Most chains are told
apart from arithmetic by their tokens alone:

- A chain with a `*{`, `(…) *{`, `{` layer after `^`, or an `actor {` head is a composition. No
  arithmetic expression has those shapes on the right of `=` in a definition.
- A trailing `^` (`V^`) can't be an exponent.
- **A chain of names only**, like `C = A ^ B`, has the same tokens as `n = x ^ 2`. Validation
  decides it by asking whether the head names a class in scope. That's the check `validate.js`
  already makes for parents ("'X' is not a class in scope"). This is fine: grammar may depend on
  scope (as `key: X` already does, through `resolveLoneNames`). It gets sturdier once names are
  resolved in general (the name-resolution ticket).

Precedence with the exponent: inside a definition chain, `^` composes left to right. It isn't
an expression, so exponent associativity doesn't apply.

## Out of scope (exists in theory)

`A = actor { … } ^ T`: a singleton with a class layered over it, so `T` has precedence and is
first responder. It's a coherent form of composition but isn't supported now. Until it is, a
class layer after a singleton head is an error.

## Open questions

1. **What a singleton layer's precedence means.** Today a trailing class block is a separate
   actor: an instance reaches its members only by message, as `C.count`, and it never answers
   for the instance. `{ … } ^ *{ … } ^ { … }`, with a singleton "with higher precedence" than
   the constructor, implies singleton layers take part in answering. Questions:
   - does a message to an instance fall through the stack from the top, singleton layers
     included?
   - and is `C.x`, a message to the class itself, answered by the singleton layers alone?
2. **Several singleton layers.** Today there is at most one class block. With several, are they
   one actor merged in precedence order, or one actor each?
3. **Parents' own singleton layers.** Is a parent's class block inherited as a layer, so that
   `V = T ^ { … }` stacks onto `T`'s singleton? Or is each class's singleton its own?
4. **`super` with mixed layers.** `super::name` / `super.name` reach "the parent layer"
   (`class-scope-and-inheritance-2026-11-16.md`). With singleton and constructor layers
   interleaved, which layer is `super` from a given one?
5. **Lineal forms.** No lineal spelling of a chain exists (none existed for `++` either).
