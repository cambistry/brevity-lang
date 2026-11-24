---
status: inbox
created: 2026-11-03
---
# File actors have no class. Should they? Review.

Their parent fills in only re, for example { re: '#<main>' }. The document actor's normalize! replies { re: '#<document>' } the same
way.

Seems like a class of generic actor? `*`? Or `#`, keeping this consistent with our DI header notation.

It should not be a class of brevity-script or something like that, because that ties external behavior to implementation.
