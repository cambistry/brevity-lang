---
status: inbox
created: 2026-11-23
---
# A constructor profile or interface as a param's type

A name can be typed with a constructor profile today:

```
make = (k (seed Integer) -> *{ x () -> (Integer) }) {
  n = k(4)
  x Integer = n.x()
  return x
}
```

The type grammar accepts a profile wherever it accepts a type. One test uses it (__tests__/classes/actor_value.test.js, "`k(args)`, `k` a param typed by its constructor profile"). Every other profile in the suite follows `as`, claiming a dependency's shape (`use X = "x" as (p) -> *{ … }`, `C = Dep as (p) -> *{ … }`).

A profile has no Opre encoding (notes/opre-type-encoding-2026-11-21.md, "No inline nodes"). So:

- In a published signature it is a compile error ("A constructor profile can't be a type here").
- In private code it compiles. The name carries its type as text and has no encoding (`typeEnc` is absent).
- Two places read that text: `isCtorProfile` in src/actor_values.js (a regex, to see the name holds an actor with a `new`), and the JavaScript codegen, which reads the profile's members to type `n.x()`.

Once the compiler stops reading type text (the "parser produces encoded types" and "code generation reads encoded types" tickets), this form has nothing to read.

Decide one of:

- A profile or interface is not a type outside `as`. Typing a name with one is a compile error, and the test moves to a form that stays (a class name, `Actor`, or a coercion with `as`).
- It stays. The parser reads it once into the structure a `use … as (p) -> *{ … }` claim already has (constructor params and an interface, their types encoded), the name carries that, and the two readers above use it.

An inline interface as a param's type (`s: { ping () -> () }`) is a parse error today and is outside this ticket unless the second option is taken.

Done when: no pass or code generator reads a constructor profile from type text, and the full suite is green.
