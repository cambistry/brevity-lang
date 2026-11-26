---
created: 2026-11-02
---
# @Box and Box are different names - constructors and functions

Problem: useBareClassNames strips the @ from class names, so Box and @Box can't both be declared, Box() constructs @Box, and @Box() generates invalid code on JS, Rust and Erlang.

Reportedly also applies to functions.

Done when:

- Box and @Box can be declared in the same file as separate classes.
- @Box() constructs the public class on all three targets, without giving the instance a registered address.
- Box() never reaches @Box.
- From outside the file, #new to @Box still constructs the public class.
- Tests and docs that construct a public class by its bare name use @Box(), including __tests__/exceptions/instance_failure.test.js. 11 test files declare a class with @, and each needs checking.
