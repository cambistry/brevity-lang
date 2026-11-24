---
status: inbox
created: 2026-11-04
---
# Report calls to an undeclared own function

@nope(1) and #nope(1) compile on every target and fail only at runtime. That holds in a function body and, since dd9b31e, in a constructor block. Validation should

  report a call to an own function that isn't declared, with its own message, e.g. '@nope' isn't a function of this actor. Bare nope(1) already gets some error,

  because it falls through to other resolution, but check that the message names the cause.
