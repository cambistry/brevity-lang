---
status: done
created: 2026-11-17
---
# Closures in classes reach enclosing names; dot access to class members is public-only

Per notes/class-scope-and-inheritance-2026-11-16.md and

notes/private-names-lexical-2026-11-16.md.

1. Closures and lambdas inside a class reach the names of the actors it's declared in
- A lambda in a class method, or in a nested `new`'s method, reads an enclosing actor's cells and calls its functions (public, protected and private), as the method itself can: W = *{ @r = { f = () -> total + #pz() x Integer = f() return x } } Today, on js and erlang, the lambda treats `total` and `#pz` as free variables, and the call fails at runtime or emits invalid code.
- erlang: any lambda called inside a class method fails, even one with no captures (`f = (x Integer) -> x + 1` in a method). Fix the dispatch so a class's lambdas run in the class.
- rust: an enclosing actor's function call inside arithmetic (`prot + #priv()`) must compile.
1. Writes to a public class-block cell through the class
- From the class's actors, `C.count <- v` (and `<|`) sets the class block's public `*` cell, in both the nested and trailing forms, and every actor of the class sees it. Today it compiles, then crashes at runtime.
- `C.count <- v` written directly in a constructor block must parse. Today it gives "A trailing '.' no longer makes a function silent".
1. The dot reaches public members only, and nothing else compiles quietly
- `C.x` reaches only a public `@x`. With only a protected `x`, it's a compile error: "'x' is protected: reach it as 'C::x'". The same for `C.h()` on a protected function. (`::` is a separate ticket; the message points ahead.)
- `x.#name`: "a private name is never reached through an address".
- `x.@name`: "a public member takes no '@' after a dot: write 'x.name'".
- `x.~name`: an error pointing at `x::name`.
- `C.nope`: "the class 'C' has no member 'nope'". `C.priv` naming a private `#priv`: "'#priv' is private to the class block of 'C'".
1. A trailing constructor gets no bare names from its class block
- A bare read, write or call of a class-block member from a trailing constructor, its methods or its closures is a compile error. Today, bare function calls compile and then fail at runtime.
- Messages:
- public `@count`: "reach it as 'C.count'"
- protected `count`: "reach it as 'C::count'"
- private `#f`: "'#f' is private to the class block of 'C', and a trailing constructor doesn't close over it"
- The nested form is unchanged: its `new` closes over every block name.

Out of scope

- `class` / `class_of(self)`, and `::` access to protected members (separate tickets).

Tests

- Wire tests for 1 and 2, and compile-error tests for 3 and 4: in __tests__/classes/class_scope.test.js (both forms side by side: closure in nested, qualified access in both, the trailing boundary, `total` shadowing) and __tests__/classes/outer_reads.test.js for plain classes. One shared script per describe, literal expectBehavior steps.
- Update the existing trailing-constructor error test in __tests__/classes/class_singleton.test.js to the new message.

Done when all of the above pass on js, rust and erlang (no target skipped), and the existing classes, functions and syntax suites still pass on all three.
