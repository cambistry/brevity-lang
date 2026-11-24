---
name: feedback-at-name-is-distinct-token
description: "Inside an actor `a`, `@a`, `#a` are different labels (classes too); outside only `@a` is exposed, on the wire bare as `a` (since 2026-11-12), consumed in Brevity as `.a`"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 44301336-9d44-47ff-9d84-291695b4a199
  modified: 2026-11-02T20:49:24.338Z
---

Inside an actor, `a`, `@a` and `#a` are DIFFERENT labels, for functions and classes alike (`@Box`/`Box`). Outside, only the `@a` version is exposed. It travels on the wire bare, as `a` (decided 2026-11-12: `@` is Brevity-internal, see `notes/at-sigil-internal-and-quoted-names-2026-11-12.md`; it was `@a` before), and a remote function is consumed in Brevity as `.a`.

**Why:** the user rejected making `@Box()` a synonym for `Box()` (2026-11-01) and stated the three-label rule outright (2026-11-02). The sigil is part of the name, not just a visibility marker. Same principle as [[feedback-published-cell-is-at-name]].

**How to apply:** never resolve one spelling to another inside an actor. `x.a` → `@a` is the only mapping, and it's the outside view. Don't cite older bare-name behaviour or notes as precedent; `notes/session-2026-11-01-own-published-cells.md` ("calling a public function by its bare name stays") is superseded.

**Reframed 2026-11-12:** the wire name *is* the name. A public function is NAMED `get`; `@get` is how Brevity source spells it. A bare source `fn` is actually named `.fn`; `#x` is named `#x`. So don't say "a function named `@get`". The three source labels stay distinct because their real names (`get`, `.get`, `#get`) differ. The user grants this is a bit confusing and may get rethought.
