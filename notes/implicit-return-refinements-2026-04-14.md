# Implicit-return refinements (2026-04-14)

> **Superseded later the same day by `self-becomes-2026-04-14.md`.** This note framed the tail-return as sugar over `self as` (a projection). That framing is wrong: the tail-return is a *different mechanism* from `self as` — it declares structural interface extension ("self becomes"), not a typed projection. The rules below about "one return per block," "defeat with `.`/`self`," "branch-type consistency," and "orthogonal to `returns`" are still accurate as syntactic facts, but the semantic framing ("implicit `self as T`") should be read as "implicit structural extension of T's interface." See `self-becomes-2026-04-14.md` for the corrected model.

Follow-up to `implicit-return-is-projection-2026-04-10.md`. Pins down the exact rules for the implicit-trailing-return / `self as T` sugar in constructor service blocks. Confirmed in conversation, no implementation yet.

## Scope

The sugar is **not template-specific** — it applies to any constructor service block. Templates are one use of it (with `self as Function` / `self as Element`), but the rule is general: a constructor block can declare a projection via a tail expression.

## Rules

1. **Trailing bare expression becomes an implicit `self as T`.** T is whatever the expression already infers or casts to. No `as T` cast needed when the type is unambiguous.

    ```
    C = <> {
      @fn = { 123 }
      "string"          -- implicit: self as Text = "string"
    }
    c = C()
    c.fn == 123
    t Text = C()
    t == "string"
    ```

    `42` as a trailing expression gives `self as Integer`. (Current examples use `42 as Integer` only because type/math-operation behavior isn't firmed up yet; the cast should ultimately be unnecessary.)

2. **`→` is Brevity's explicit `return` glyph.** Bare trailing expression and `→ expr` are the same feature — implicit vs explicit form of the same tail return. They don't differ in semantics.

    ```
    Double = <input Integer> {
      @original = input
      → (input * 2) as Integer
    }
    d = Double(100)
    d.original == 100
    d as Integer == 200
    ```

3. **One return per block.** A service block can have multiple `self as T` projections, but only **one** of them can be the tail return. Additional projections must use the explicit `self as T = ...` form earlier in the block.

4. **Tail-return lands at the end of the type-match list.** If a block has explicit `self as Integer = ...` entries earlier and a tail expression as well, the tail-return-projection is the *last* entry in the match list. (Functionally it'd make more sense at the beginning, but visual semantics won — the trailing thing is the trailing thing.)

5. **Conditional tail returns are allowed**, but v1 requires **branch type consistency**. `if cond → a else → b` must have `a` and `b` the same type. Divergent-branch-type unions are out of scope for v1. Non-local return isn't supported currently anyway.

6. **Defeat the implicit coercion with trailing `.` or `self`** (silent return). "Last line is `@x = ...`" is **not** a valid defeat criterion, because assignment expressions evaluate (Ruby-style) — so `@x = 1` at the tail would still be a bare expression of whatever type `1` infers to. The only way to opt out is to end the block with `.` or `self`.

## Relationship to `returns` keyword

**Orthogonal.** The implicit-return sugar *is* the tail-returns form at the end of a constructor service block. Conceptually the service block is extended `init`, so it would normally return `.`/`self`; this affordance lets the actor "become something else" — project as another type, or even be substituted with a different instance of its own type — while still being instantiated per the original call site.

If captured as its own type (no narrowing at the use site), the returned instance is addressed normally with dot methods etc. If narrowed to a projection type at the use site, it's used as that projection. This is the same story as `implicit-return-is-projection-2026-04-10.md` — one identity, multiple contextual views.

## Coexistence with `self as Function` for templates

The template direction (`self as Function` producing a live DOM element or array of elements) is one *application* of this general mechanism, not a separate feature. Template-work is not focused on producing a templating function — current target is live DOM output. Template-as-function may have a use but isn't the focus.

## Status

Design confirmed in conversation 2026-04-14. No implementation work yet. Do not start implementing without confirming the direction has settled.
