---
status: done
created: 2026-11-01
---
# Close the gaps in effect checks

`src/effects.js` skips the cases below. All of them compile today and should be errors.

**`!` functions declared inside a function body**

File-level and class-level `!` functions are checked, but these aren't:

```brevity
n *Integer = 0
@go! = {
  f! = {
    n <- 1
    n
  }
  f!()
}
```

This covers a tail value, a bare tail `self` and never writing. They should give the same errors as a file-level `f!`. The session note also says that calling a local function that reaches only its enclosing function's cells doesn't make the enclosing function a writer, so confirm that while here.

**`->` slots other than a local function's params**

A writing function should be rejected in any slot declared `->`, including type fields and doc params. The check is `checkReadOnlySlots`.

```brevity
::R (f: () -> ())
x *Integer = 0
@go! = {
  r = R(f: () -> { x <- 1 })
  return 1
}
```

```brevity
*
  "svc.bv": Svc () -> *{ take (f: () -> ()) -> () }
*
x *Integer = 0
@go! = {
  s = Svc()
  s.take(f: () -> { x <- 1 })
  return 1
}
```

**Discarded reads on typed params**

This should give `'.g()' only reads, and its result is discarded`:

```brevity
C = *{ @g = { return 1 } }
@go = (c C) {
  c.g()
  return 1
}
```

`purportedFunctions` already reads typed params, so the two checks could share receiver resolution.

**Tests:** validation cases in `__tests__/functions/bang.test.js`. No runtime fixtures are needed.
