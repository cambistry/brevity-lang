# Constructor tail values and `ingest` are retired — 2026-11-26

Decided in discussion. Extends `constructor-return-as-retired-2026-11-23.md`, which covered
only `return expr` / `-> expr` at a constructor tail, and supersedes its rule section
(`return self` / `return ()` staying). Findings in the ticket
`retire-constructor-return-as-findings`.

## Return in a constructor block

- **A constructor block returns no value.** Its result is always `self`, so it has nothing
  to return.
- **A bare `return` is an early exit.** It ends construction there; the result is still
  `self`.
- **`return` with any operand is an error,** `return self` and `return ()` included. It's a
  real form misused, so it gets a specific diagnostic stating the rule.
- **`->` is not a return.** In a body, `-> x` is a zero-arg lambda value
  (`return-keyword-and-arrow-2026-10-26.md`); a constructor block gives it no other meaning.

## Decisions

- **A constructor has no tail value.** A literal, `( … )`, `[ … ]`, an HTML literal or a lone
  name at the end of a constructor block sets no declaration return; the end of the block is
  not a tail. Such an expression is an ordinary expression statement. Whether an unused value
  deserves a warning is a separate question, for any body.
- **The file opener `-> expr` / `return expr` goes.** It is the file-as-class form of the
  same declaration return. A file projects with `self as`, as a class does.
- **`ingest` goes:** the keyword, `IngestExpr` and `inheritedIngests`. Its only supplier
  was a subclass's bare tail (`Sub = Base ^ *{ "hello" }`); without one, `ingest(default)`
  is only a default.
- **A child supplies a parent's value by redeclaring it above `super()`.** The parent's
  initializers run at the child's `super` line, so they derive from the child's value, which
  covers what `ingest` was for: the child states itself succinctly, and the parent unwraps
  it into its own representation.

  ```brevity
  Base = *{
    label Text = "base"
    size Integer = Text.size(label)
    @size = -> size
  }
  Sub = Base ^ *{
    label = "hello!"
    super()
  }
  ```

  `Sub().size()` replies 6 on js and erlang. A redeclaration below `super` (or with the
  implicit `super` at the top) leaves the parent's initializer reading an unbound name; the
  rule for that is `investigate-construction-time-reads-of-a-subclass-cell`.
- **Memoization goes with it.** A declaration return was evaluated once at init. A `self as`
  clause evaluates on each `$as` (`session-2026-11-01-as-renders-or-fails.md`), and that is
  accepted.

With these, `declarationReturn` has no source form, as the 2026-11-23 note assumed.

## TextDiv

The retirement doesn't wait on a working `self as HTML::div` replacement. The usual case is a
function returning the element (`escaping-frames-2026-11-23.md`). Two failures in the
replacement path are bugs on their own, with tickets of their own:
`fix-binding-an-element-projection-gives-a-self-contradicting-error` and
`fix-reactive-interpolation-in-a-self-as-element-clause`.
