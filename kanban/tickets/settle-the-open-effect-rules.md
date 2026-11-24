---
status: done
created: 2026-11-01
---
# Settle the open effect rules

Each question below needs a decision, then implementation in `src/effects.js` with validation tests in `__tests__/functions/bang.test.js`.

**Class construction**

- **Subclass of a writing class:** `D = (W |) *{}` compiles without `!`, though constructing it writes.
- **Class named `!` that never writes:** `V! = *{ @g = { return 1 } }` compiles.
- **Override of a foreign class's `!`:** `C = (S |) *{ @g! = { return self } }`, where dependency `S` declares `g! () => self`, is rejected with `'@g!' never writes`. The exception only works for a parent found in the file.

Recommendation: a constructor follows the same rules as a function. The subclass and the never-writing class become errors, and the foreign override is allowed.

**Functions and fields**

- **Anonymous functions in a `=>` slot:** does one fall through to self, or does the arrow decide what it must produce? Recommendation: the arrow decides.
- **`!` on type fields:** `::T (n!: Integer)` compiles, though it's a value field. Recommendation: a field's arrow states its effect. Then decide whether `run!:` is allowed at all.
- **Fresh remote actors:** `t = Thing()` exempts writes to `t` until it escapes, even for a dependency, whose constructor may reach shared state. Decide whether the exemption covers dependencies.

**Cells**

- **`<-` as a value:** `return a <- x` is a compile error, and there's no mechanism for returning a cell reference. Choose between building it, yielding the new value, or making the error permanent.
- **Inside writes to published cells:** `@log *Text` has no inside-write form (`log <- x` and `@log <- x` are both errors, including before this work), so `untracked @log` only helps writes from other actors. That undercuts the logging case that motivated it.
