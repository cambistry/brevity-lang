# Generic function arguments: does the language need them? (2026-11-03)

This came up while extending the annotation check (`session-2026-11-03-annotation-check-extended.md`).
To check `x Integer = pick(v)`, the compiler has to know which overload of `pick` runs, and that
depends on the type of `v`. If `v` is an untyped param, it can't tell.

The question: type inference already lets params go without type declarations, so what is a truly
generic parameter actually for?

## "Generic-by-default" isn't a feature

`return-type-inference-2026-05-06.md` says private functions are "generic-by-default": an untyped
param accepts anything, and nothing narrows it. That describes what the compiler doesn't do. It
isn't something anyone needs.

A private function's callers are all in the same file. The compiler sees every call site, so an
untyped param doesn't have to mean "unknown". It can be inferred from what the callers pass, with
the return re-typed per call site: `max(1, 2)` gives Integer and `max(1.5, 2.5)` gives Decimal.
That costs compiler work, and recursion needs a fixed point.

## Two corrections from the discussion

- **At run time nothing becomes a union.** Each call returns its actual type, and `ty` carries it.
  An early draft said that "every call to `max` would return `Integer | Decimal`" if a param were
  typed as the union of what callers pass. That's wrong at run time; the concern was only what the
  compiler can verify at a call site.
- **`max` declared with `(Integer | Decimal)` is a union, not a generic.** Per-call-site inference
  over a union param isn't generics either.

## Where generics would matter

Values always carry their real types, so at run time generics add nothing. They matter only for
compile-time verification, and for one thing: a signature that relates its output type to its
input type, when the caller sees only the signature and not the body.

Inside a file the caller sees the body, so call-site inference covers it with no generic syntax.
That leaves **cross-file signatures**: a service's doc, or a public handler. Today these can't
express such a relationship:

1. **Containers of open-ended element types.** `first (xs List of T) -> (T)`,
   `chunk (xs List of T, n Integer) -> (List of Lists of T)`. A union doesn't help, because the
   element can be any user type or class. Today the doc says `List of Anything`, the result is
   `Anything`, and the caller needs an `as`. The built-in list methods already do this internally
   (the `'Element'` return placeholder in `list_methods.js`, resolved in `inference.js`), but user
   code can't express it.
2. **Functions passed as arguments.** `apply (f, x)`, or a `retry (f)` wrapper, whose result is
   whatever `f` returns. Today a function param gives an `Anything` result.
3. **Boundary types.** The one closest to the project's design: `sign (x T) -> (Signed of T)`,
   `verify (s Signed of T) -> (T)`. The trust model is built on `Signed of X` and `Cosigned of X`, a
   boundary type being a state transition on X. A function that performs a transition has to keep
   X. Without generics `verify` returns `Anything`, and the compiler loses track of what was signed,
   which is exactly where trust is enforced.

A minor one: tying two params together, as in `swap (a T, b T)`. In practice a union or numeric
promotion covers it.

## The case for removing generic args

- No generic functions are needed inside a file. Call-site inference of private params, with
  per-call-site returns, gives what generics would.
- That removes most of the annotation check's "unknown argument" case. Overload selection inside a
  private function is decided per call site, and what's left unknown is `Anything` slots and values
  from the wire, which are unjudged anyway.
- Recommendation from the discussion: drop "generic-by-default" as a stated model, and make
  call-site inference of private params, with per-call-site return types, its own ticket. The
  annotation check would then build on it rather than work around unknown params.

## The cost

The three cross-file cases above still **work at run time**, through `ty` and `as`. They're just
**checked at run time instead of compile time**:

- container helpers in a doc return `Anything`, and callers write `as`;
- higher-order helpers lose their result type;
- `Signed of X` / `Cosigned of X` transitions across a service boundary lose X statically.

## Would removing it simplify compilation? No

Removing it brings better checking, not a simpler compiler.

**Untyped params aren't the only source of `Anything`.** Explicit `Anything` slots, values from the
wire, results of calls to function values, docs saying `List of Anything`, and return paths that
widen to `Anything` (`return_shapes.js`) all stay. So does the runtime machinery for them: the
dynamic arithmetic helpers (js `_bv_num_op` / `_bv_div`, rust `bv_dyn_arith`, erlang `bv_num_op/3`,
see `session-2026-10-29-untyped-param-arithmetic.md`), Rust's `Value` path, and the `Anything`
branches across the backends. Fewer values would take those paths; the paths wouldn't go away.

**The replacements cost more than they save:**

- **One type per param (the union of callers)** is cheap, but a union-typed param is still dynamic
  in the backends, so codegen doesn't simplify. Only the validator gains.
- **Return typed per call site** means re-typing a body for each set of arg types, plus a fixed
  point for recursion. If codegen uses the result, that also means a copy per type signature on
  three targets, with mangled names that tags, docs and dispatch must agree on. If codegen ignores
  it, it's validator-only work.

**The real benefit is correctness:**

- The class of bug from 10-29, where codegen guesses an untyped operand's type from the other
  operand, shrinks inside private functions.
- The annotation check's unknown-arg case mostly closes, so overload selection becomes "the
  selected clause" more often than "every clause the args could select".
- Rust could use concrete types instead of `Value`, but only with codegen specialisation, the
  expensive option.

**What would simplify compilation is fewer sources of `Anything`,** for example docs and function
types that state element and result types. That is the cross-file type variable weighed above. So
the trade-off runs the other way from what you'd expect: a small, explicit generic in signatures
would remove more `Anything` handling than taking implicit generics out of private functions would.

## Open

Whether that cost justifies a type variable in docs depends mostly on how much boundary types should
be checked statically. Not decided.
