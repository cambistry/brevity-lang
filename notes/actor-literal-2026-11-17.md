# Actor literal: `actor { }` replaces braced `**{ }` — 2026-11-17

Decided and implemented. Builds on `class-singleton-forms-2026-11-13.md` and
`class-scope-and-inheritance-2026-11-16.md`.

## Why

A class is a relationship, not a type: an actor is a class relative to the actors its `new`
makes. So a class block needs no class-specific syntax. It is an actor literal, and the literal
is spelled `actor`.

## Forms

```brevity
s = actor { … }                          // inline singleton
@s = actor { … }                         // public singleton
one = actor -> @get = -> 7               // one-line actor: a single statement, to the line end
C = actor { … new = (p) *{ … } }         // nested class
C = (p) *{ … } ++ actor { … }            // trailing class block
actor { body }                           // file header, no DI
( entries ) [->] actor { body }          // file header, delimited DI
```

- **The trailing form takes `++`.** Juxtaposition (`} actor {`) isn't a class. It is refused with
  the fix, and so is the old `} **{`. This settles the `++` open question in the class-scope note.
- **`actor ->` takes one statement on the same line.** The line break ends the actor, and is left
  to the enclosing body. `actor ->` with nothing after it on the line is an error.
- **`actor` is contextual.** It is a keyword only before `{` or `->` where an actor literal can
  start: the right of `=`, after `++`, at a file's head. Elsewhere it is an ordinary name
  (`actor *Integer = 1`). As an actor member, `f = actor -> …` is an actor literal, so a
  one-param bare lambda there whose param is named `actor` needs parens: `f = (actor) -> …`.
  Inside a function body, `f = actor -> …` is still a lambda.
- **An unnamed literal is an error.** `actor { }` standing alone in a body is refused: a singleton
  is named. At a file's head it is the header, and later in the file it is "a file header must
  open the file".
- **The interface document matches the source:** `C (Integer) -> *{ … } ++ actor { … }`.

## Retired

- Braced `**{` is a parse error everywhere: "'**{ … }' is now 'actor { … }'". There is no
  deprecation period.
- Unchanged: the lineal `**` … `**` file header, lineal singletons (`C = **`, then members to the
  first blank line), and `class` as the role word.

## Not yet implemented

- `++` composition beyond the trailing form, in other orders (`actor { } ++ (p) *{ }`,
  `T ++ (p) *{ } ++ actor { }`). The class-scope note gives the direction. The leading
  juxtaposed form (`actor { } (p) *{ }`) stays refused.
