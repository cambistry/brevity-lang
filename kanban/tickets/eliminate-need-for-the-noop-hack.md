---
status: inbox
created: 2026-11-19
---
# Fix: an actor should not need the noop hack

Expected:

- An actor should certainly be valid if it has any public interface, such as an actor-cell (@pub *Integer…).
- And it should also be valid even if it only has protected names, since it can, theoretically, be subclassed and these become accessible by the subclass.
- An actor with nothing but private names seems like a compilation error, even if its construction, or especially if its construction, creates one-time side effects. That is simply one-time execution.

Problem (checked 2026-11-25):

- Only a public cell (`@pub *Integer = 1`): builds and answers on js, rust and erlang.
- Only a protected cell (`x *Integer = 42`, read with `test.get '~x'`): works on js. Rust and Erlang emit an empty program: rust fails with "`main` function not found in crate `brevity_actor`", erlang with "no module definition". Adding `@noop = -> x` makes both work, so the hack still covers this.
- Only private names (`#f = -> 1`): compiles. It should be a compile error.

Done when protected-only actors build on rust and erlang, a private-only actor is a compile error, and every `@noop` that exists only to make an actor build is gone. Files with one: __tests__/types/type_interface.test.js, types/type_imports.test.js, marshal/capture.test.js, cam_test/get.test.js, cam_test/set.test.js, destructure/params.test.js, functions/overload.test.js, services/interface.test.js, services/extract.test.js, syntax/unexpected.test.js.
