---
status: inbox
created: 2026-11-02
---
# Fix: remaining gaps in a / @a / #a as separate names

**Background:** inside an actor, a, @a and #a are different labels, for functions and classes. Outside, only @a is exposed. 7d7860d implemented this on JS, Rust and Erlang, and these gaps remain. Items marked "unverified" come from reading the code or were never tested, so probe them first. Design notes are in notes/session-2026-11-02-at-names.md.

**Check the "different names" rule (do these first)**

- [ ] **untracked (unverified):** Problem: untrackedNames in src/effects.js matches by bare name, so untracked a probably also exempts @a. Expected: it applies only to the name it spells.
- [ ] **Templates (unverified):** establish how <Box> and <@Box> behave with a local class when Box, @Box or both are declared. My one probe hit a syntax error, so this is unknown. Expected: <Box> doesn't reach @Box.
- [ ] **Box as a plain value:** Problem: with only @Box declared, using Box without calling it isn't caught at compile time. Expected: it gives 'Box' isn't in scope — the public class is '@Box', as calls, superclasses and type annotations do.
- [ ] **False compile error (unverified):** Problem: a class with its own @helper that calls a file-level private helper() probably gets 'helper' isn't in scope, because checkBareCalls in src/chains.js only looks at the class's own names. First establish whether a class can call file-level functions at all. Expected: if it can, this call compiles and reaches the file's helper.

**Internal name leaks**

- [ ] **Box__pub in runtime messages (unverified):** Problem: only compile errors are translated back to @Box. Check whether a runtime ex that names a class, such as a failed as, shows Box__pub. Expected: it shows @Box.

**Decision needed**

- [ ] **Actors from remote callers:** Problem: a param typed @Box only works with an actor from the same process. A remote caller has no valid tag to send, because the type check expects the internal Box__pub, and there's no defined way to pass a registered address like @Box/1 as an arg. Decide what a remote caller sends, or make it a clear error, then implement that on all three targets.

**Rust only**

- [ ] **Address numbers:** Problem: they share a counter with unregistered instances, so #new after two @Box() calls answers @Box/3, where JS and Erlang should still answer @Box/1. Nothing else is registered, so this is a consistency fix. Expected: #new addresses are numbered separately, and tests can then assert exact addresses in a fixture with a file-level @Box().
- [ ] **Class names that differ only by case (unverified):** Problem: class names are lowercased internally, so Box and box would likely collide. This predates 7d7860d. Expected: either they stay separate or it's a compile error.
- [ ] **Wrapped-call fix cleanup:** Problem: handleTypedAssign_Generic in src/codegen/rust/statements.js detects a call on a wrapped superclass by checking the generated code's prefix ({ let _cn = ). Expected: a check on the AST or context replaces it.

**Done when**

- Each box above is either fixed or closed with a recorded reason, and each unverified item has a probe result.
- Every behaviour fix has tests on JS, Rust and Erlang, in the shared-fixture style with no per-target skips.
- notes/session-2026-11-02-at-names.md is updated, and any language-visible change is reflected in docs/SYNTAX_CRIB.md.
