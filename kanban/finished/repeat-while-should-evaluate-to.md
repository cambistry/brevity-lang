---
created: 2026-05-07
---
# repeat while should evaluate to ()

repeat while / until should compiler error if used in an assignment, including function return.

Introduce the concept of an empty return value list. Represented on CAM as re: [].

Happens a little unnaturally - e.g. when a repeat statement is at the end of a function.
