---
created: 2026-11-11
---
# Reject reads of a cell before its declaration in a constructor block

_A constructor block runs in text order. Today, a statement that reads a cell above the line declaring it compiles, and reads whatever the target holds before initialization: undefined on JS, null on Rust, and the not-yet-run initializer's value on Erlang. Make it a compile error._

_**Rule:** in a constructor block, an actor may not read one of its own cells before that cell's declaration. "Read" covers:_

_- a direct read of the cell;_

_- a read inside any of the actor's own functions called at that point, followed through further self-calls;_

_- passing the cell's value to a child's constructor;_

_- a nested class constructed at that point that reads the cell._

_Referring to a cell in a function or lambda that isn't called during construction is fine._

_**Error:** 'name' is read before its declaration — move the declaration above this line. The cycle x Integer = y / y *Integer = x produces the same error._

 _**Out of scope:**_

 _- control flow (if) in constructor blocks;_

 _- calls through function values (ticket 2)._

  _**Tests:** __tests__/classes/init_order.test.js, with compile-error cases for each kind of read above and runtime cases on all three targets for the allowed ones. Existing programs that relied on forward reads get fixed, not dropped._

_**Design:** notes/forward-reads-in-constructor-blocks-2026-11-11.md_
