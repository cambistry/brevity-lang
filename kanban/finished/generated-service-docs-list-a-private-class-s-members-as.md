---
created: 2026-11-01
---
# Generated service docs list a private class's members as file-level ops

A class that isn't public has its `@` functions listed at the top level of the file's generated service doc, with no entry for the class itself:

```brevity
C = *{
  @g = { return 1 }
}

@go = { return 2 }
```

The generated doc includes `g` alongside `go`, although the file has no `@g` op, so a caller reading the doc would see an op that doesn't exist.

**Cause:** `buildServiceDocument` in `index.js` loops over every entry in `ast.actors`. Actors named with `@` get a constructor entry and then `continue`. All others, including private classes, fall through to the code meant for the file's own actor, which lists their public functions.

**Expected:** a private class isn't part of the file's public surface, so its members are left out of the doc. Public classes (`@C`) keep their `C () -> *{ … }` entry, and the file's own functions are unchanged.

**Check when fixing:**

- **Inherited members:** whether a public class or the file inherits from a private class, and if so, whether those members should appear.
- **Existing assertions:** any tests that rely on the current flat listing.
- **Doc consumers:** `remotes` and the `parseInterface` readers, in case anything depends on these entries.

**Existing behaviour:** the same listing appears on `92e6eda`, so this predates the mutation-suffix work.

**Tests:** a doc for a file with a private class omits its members, a public class's entry is unchanged, and a same-named member in a private class doesn't collide with a file-level function.
