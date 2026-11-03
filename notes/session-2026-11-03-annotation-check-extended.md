# Session 2026-11-03: the annotation check reaches more values

Follows `session-2026-11-01-return-shapes.md`, whose "Left unjudged" list this mostly closes.

```brevity
x Integer = y            // y Text: error
x Integer = f() + 1      // f returns Text... no rule for Text + Integer: left alone
x Text = f() + 1         // f returns Integer: error
x Integer = pick(1)      // the clause (n Integer) returns Text: error
t = Thing(a: 5)          // in a handler: t is a Thing now, as it was at file level
t.nope()                 // error: 'Thing' has no function 'nope'
```

## Decisions

**An overload's annotation holds for every clause the args could select.** Clauses match in order.
Each clause that accepts the call's arity and names is weighed on its arg types:

- every arg certainly fits: it's the last candidate, the search stops;
- some arg might fit (unknown type, a union, a class a subclass could fill, `Self`): it's a
  candidate and the search goes on;
- some arg can't fit: it's passed over.

So with known args this is the selected clause, and otherwise every candidate counts. The same
selection applies to a class's overloaded method and to a doc with several signatures. A function
with a single definition is judged as before, whatever its args. When no clause fits, the call is
left unjudged; the arg checks report that.

**A name may have been narrowed, so it's judged loosely.** There's no flow narrowing, and
`if y == null { return 0 }` then `x Integer = y` is common. So a value a name's type flows into is
wrong only when *no* member of its type could hold the annotation. `y Integer | null` passes, and
`y Text | null` fails. Anything else (a literal, a call, an expression of those) has to fit with
every member, as call results already did.

**A literal takes its annotation's form.** `d Decimal = 0`, `e Float = 1 + 2` and `b Blob = "hi"`
are fine, and so is any numeric literal bound to any numeric type. A Boolean literal bound to
`Integer` is an error.

**A name holding an actor is left to the runtime.** `n Integer = c` asks `c` for `as Integer` at run
time (`type_coercion.test.js` checks that this fails at run time for a class with no clauses), and a
name typed as a class may hold a subclass that has clauses. This belongs to the runtime `as` ticket.

**`t Thing = Thing()` is no conversion.** The dependency typed-assign check had been rejecting the
dependency's own class, with "No matching 'self-as' clause".

### Still left unjudged

- `Anything`, types the file doesn't know, classes with `as` clauses (unchanged).
- A mixed operator pair like `Text + Integer`, and a union operand to arithmetic.
- A function name defined in more than one class or file scope (owners differ).
- Statements inside nested blocks. The check only sees a handler's top-level statements, as before.
- `x *T = value` (a `RefDecl`), and file-level binds outside handlers.

## Code (`src/validate.js` unless noted)

- `buildTypeEnv` takes `depNames`: an untyped `t = Dep()` is typed `Dep`, which closes the member
  check and the annotation check for a handler's local.
- `resolveCall` (was an inline IIFE) also returns `fns` for a function with params or overloads.
- `selectClauses` / `clauseFit` / `argFit`: the overload selection. `callReturns` merges the
  selected clauses' shapes (`mergeShapes`, `src/return_shapes.js`). `remoteReturnShapes` takes the
  same selector.
- `valueType`: types a non-call value. A call is the union of its positional slots, and operators
  use `binaryResultType`, now exported from `src/inference.js`. `??` drops `null` from the left.
- `checkAnnotationValue`: the judgement and messages for a non-call value.

## Found on the way, not fixed

- **Runtime: a self-call to a typed overload dispatches by arity only.** The JS clause guard is
  `from === '__self' || _matchTypes(…)`, so `pick(v)` with `v Text` runs the `(n Integer)` clause and
  the handler fails. The compile check follows the language's rule (first clause whose types accept),
  so it doesn't raise false errors, but at run time the selected clause isn't the one that runs.
- `over` is a keyword: `over = (n Integer) { … }` fails with "file actor takes no body opener".

## Test fixtures that were wrong

`bang.test.js` bound `n Integer = s.run(…)` (and `s.take`, `s.pos`) to doc entries returning only
`(n: Integer)`. A handler-local `s = Svc()` is typed now, so that's caught; they destructure `:n`.

## Tests

`__tests__/functions/return_shapes.test.js`: annotation on a value that isn't a call, on an
overload, and a dependency instance held in a handler's local.

## Verification

js: `__tests__/{functions,types,destructure,classes,core_types}` (104 suites). Rust and Erlang:
`return_shapes` and `bang`. The full suites were not run.
