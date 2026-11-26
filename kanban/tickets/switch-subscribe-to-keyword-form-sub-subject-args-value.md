---
status: queued
created: 2026-11-10
---
# switch `subscribe` to keyword form: sub subject[(args…)], (value) { handler }

**Want: subscription is a keyword form: `sub subject[(args…)], (value) { handler }`**

Replace the method spelling x.subscribe (v) { … } with a keyword form shaped like over. The subject is the first argument, and any args for a parameterized subscription follow it.

**Today (why):** subscribe is already a reserved keyword (src/lexer.js:1). The parser special-cases .subscribe into a SubscribeCall node (src/parser.js ~2341, plus the class-body case ~5011), and the wire op is the protocol's subscribe@<cell>, not a user handler. So the method spelling only imitates a method call. A user type can't define .subscribe, despite what notes/subscription-via-multi-re-2026-04-18.md says. A keyword form is honest about this and matches over(coll) (p) { … }. Subscription is still a protocol capability a cell or op exposes (a * member in an interface implies get/set/subscribe); only the call-site spelling changes.

**Grammar**

```brevity
sub n, (v Integer) { Svc.note(v)... }       // a class's param
sub(c.x, (v) { seen <- v })                 // a child's / remote's cell
sub @pub, (v) { lastPub <- v }              // own published cell
sub #priv, (v) { lastPriv <- v }            // own private handler
sub c.pub(p: 100), (v) { last <- v }        // parameterized: args after the subject
sub #parameterized(p: 10), (v) { lastA <- v }
sub(abc, &fn)                               // or pass a function reference (local or remote)
```

- The first argument is fully-formed call.
- Then the lambda: its params bind each delivered re, and the body runs on the first delivery and on every later one.
- The spacious and lineal forms follow whatever over accepts. Check over's forms and mirror them; don't invent new ones.

**Want: the keyword is `sub`.** `subscribe` stops being reserved, so `@subscribe` is a valid public name, and `x.subscribe(…)` is an ordinary member call. With the special parsing removed, `x.subscribe (v) { }` fails like any other bad call; no form-specific diagnostic.

**Scope**

- **Parser:** add the keyword-first form, producing the same SubscribeCall AST (target, args, params, body), in both expression position and class-body position (today's ~5011 path, which routes class-body subscriptions to initBody). Remove the .subscribe parsing; swap `subscribe` for `sub` in the lexer's keywords.
- **No codegen or wire changes are expected**, since the AST stays the same. If anything outside the parser reads SubscribeCall differently, find out why.
- **checkParamSubscribes** (src/validate.js, from a3dd51b) must still refuse subscribe(n) … on a function's own param.
- **Migrate the existing uses:** about 50 lines in 10 test files (grep -rn '.subscribe' __tests__), plus any in docs/ or notes/ examples. No .bv files use it.
- **Notes:** add a new note that supersedes the surface-syntax section and the "not a reserved keyword" bullet of notes/subscription-via-multi-re-2026-04-18.md, and add a pointer to it from that note. Don't rewrite the old note.

**Tests**, on js, rust and erlang:

- Each subject kind above: a class param (positional and named, & and *), a child's cell, own @pub, own #priv, and parameterized with args.
- A first delivery plus each later write: the existing subscribe and readonly_param live tests, migrated.
- x.subscribe (v) {} and x.subscribe(p: 1) (v) {} fail (assert only that they error).
- The parse error for subscribe(c.pub(p: 100)) (v) {}.
- A function subscribing to its own param is still a compile error.

**Decided (2026-11-26): a header-less `sub` is valid.** A ping that something changed is a fair
use. The lambda's header fits the subscribed function's output Object under the normal
destructuring rules: it takes any subset, including nothing, so `sub @pub, () { effect }` (or
whatever header-less form `over` accepts) is fine. Accept exactly the forms `over` accepts.
