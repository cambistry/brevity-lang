---
created: 2026-11-27
---
# Design: a view type passed to a parameter

From `notes/file-views-and-codecs-2026-11-27.md`, open question "A projection at a parameter".

```brevity
ls = Lines("a\nb")
map(ls) (l) { … }     // is ls taken as its List[Text] presentation?
over(ls) (l) { … }
```

Today: an actor's `self as` applies at a typed bind. `an-as-in-an-argument-does-not-project`
(finished) covers `as` in an argument.

Decide: whether a parameter typed `List[Text]` takes a `Lines` through `self as List[Text]`, and
so whether iteration needs any protocol beyond presentations.
