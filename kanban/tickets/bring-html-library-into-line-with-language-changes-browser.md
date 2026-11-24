---
status: done
created: 2026-11-05
---
# Bring HTML library into line with language changes (browser tests)

‌

  **1. \_\_tests\_\_/html/element.browser.test.js: 14 failures, introduced by 1ced0a1** ("a caller's annotation is checked on names, expressions and overloads", 11-03)

- All are "X compiles" tests that now throw, for example 'div.query_selector()' arguments don't match any signature: (selector: Text). expected 0 positional arg(s),

    got 1. Others fail the same way: get\_attribute, set\_attribute!, toggle\_attribute!, closest, matches, scroll\_to!, clone_node() ("missing: deep"), and the void-tag

    variants.

- **Cause:** that commit types a handler-local d = div() as its class, so calls on d are now checked against the class's methods. The HTML manifest in

    src/codegen/browser/runtime.js declares each of these methods as overloads: query\_selector (Text) and query\_selector (selector: Text), and clone_node (),

    (Boolean) and (deep: Boolean). The check reports only the named signature, so the positional and no-argument forms are rejected. The check comes from

    src/validate.js:3743.

- A git bisect between 743f533 (passes) and 1ced0a1 confirmed it.

‌

  **2.** **\_\_tests\_\_/keywords/if.test.js,** **"a** **bind** **after** **a** **branch":** **2** **failures,** **introduced** **by** **bb975bc** (11-02)

- "a statement call after a branch runs on the path past it" and "a call after a branch runs on the path past it" reply ex: "error" instead of a value. They pass on

    the js target.

- **Cause:** the page doesn't use index.js's extract. src/codegen/browser/brevity.js keeps its own copies of the extract passes, and they've drifted. bb975bc added this

    line to assignClosureAddresses in index.js only:

  if (fn.name.endsWith('!')) continue; // a function that writes has nothing to subscribe to

    In the browser, bump! = { n <- n + 1; return n } still gets renamed to the closure address \@0. A call to bump!() is then compiled as a call to a function value,

    and the page throws ReferenceError: bump$w is not defined. I confirmed this by instrumenting the page in a scratch worktree, which I've since removed.

- These tests have failed on browser since they were added.

‌

  **Other drift between the copies:** I compared all eight duplicated passes. liftReactiveElements also differs: the browser copy lacks the cloneCache WeakMap that

  9791547 (04-29) added to index.js. No test in this run fails because of it, but it's the same kind of drift and could break the browser target the same way.
