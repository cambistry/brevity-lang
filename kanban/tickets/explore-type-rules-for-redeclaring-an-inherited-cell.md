---
status: inbox
created: 2026-11-17
---
# Explore: type rules for redeclaring an inherited cell

Background: discussion of 2026-11-16.

Today: a subclass may redeclare a parent's cell, and the redeclaration is late-bound: the parent's own code uses the subclass's cell. The parent's code was type-checked against the parent's declared type, so a redeclaration that changes the type can break code the subclass's author never wrote:

```
T = *{
  total *Integer = 0
  @bump! = { total <- total + 1 }
}
U = T ++ *{ total *Text = "x" }      // T's @bump!, run for U, does Text + 1
```

Narrowing is the subtle case:

```
T = *{ total *Integer | Text = 0 }
U = T ++ *{ total *Integer = 0 }
```

T's reads are safe (they expect Integer | Text and get Integer), but T's code may write "x" into a cell that can't hold it. A `*` cell is both read and written, so it is invariant. This is the classic variance problem: Eiffel's covariant field redefinition gave runtime "catcalls", and Java's covariant arrays fail with ArrayStoreException.

Proposed direction (to evaluate, not decided)

- A `*` cell's redeclaration keeps the parent's type exactly.
- A constant (non-`*`) may narrow, since the parent's code only reads it.
- A redeclaration may omit the type and inherit it: `timeout = 5`. This is the common config-override case.

Questions to answer

- Is invariance for `*` cells too strict in practice? Are there real uses for narrowing a writable cell, and could they be served another way (a protected setter the subclass overrides, a separate cell)?
- Does narrowing a constant interact with anything that writes it indirectly: `ingest` slots, DI-filled params, initializers that read other overridable names?
- What about widening (the child's type a superset of the parent's)? Parent writes are safe, parent reads aren't. Presumably an error; confirm.
- Read-only refs (`&Type`) and published cells (`@x`): do they follow the constant rule or the cell rule? A published cell can be written by `$set` from outside.
- Class blocks under the delegated rule: the same rules for a subclass block redeclaring a parent block's cell? Any difference when the parent block is remote (its code typed against its own declaration, which the child can't see)?
- Interfaces: does the service document or extension interface need to say which cells may be redeclared, and with what type freedom?
- Runtime-checked narrowing as an alternative: rejected so far because the error surfaces in the parent's code. Note why, or find a case for it.
- Precedent survey: Scala (val may be overridden covariantly, var may not), Kotlin (override val may narrow; override var must match), Swift, C#, TypeScript (property bivariance), Eiffel.

Deliverable

- A note in notes/ recording the rules and the reasoning, including the cases rejected.
- A list of compile errors (wording and conditions) and the wire tests to add, to be done under the implementation tickets. Exploration only: no code required.
