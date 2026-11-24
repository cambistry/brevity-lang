---
status: todo
created: 2026-11-10
---
# switch `subscribe` to keyword form: sub subject[(args…)] (value) { handler }

**subscribe is a keyword form: sub subject[(args…)] : (value) { handler }**

Replace the method spelling x.subscribe (v) { … } with a keyword form shaped like over. The subject is the first argument, and any args for a parameterized subscription follow it.

**Why.** subscribe is already a reserved keyword (src/lexer.js:1). The parser special-cases .subscribe into a SubscribeCall node (src/parser.js ~2341, plus the class-body case ~5011), and the wire op is the protocol's subscribe@<cell>, not a user handler. So the method spelling only imitates a method call. A user type can't define .subscribe, despite what notes/subscription-via-multi-re-2026-04-18.md says. A keyword form is honest about this and matches over(coll) (p) { … }. Subscription is still a protocol capability a cell or op exposes (a * member in an interface implies get/set/subscribe); only the call-site spelling changes.

**Grammar**

`sub n, (v Integer) { Svc.note(v)... }`          // a class's param

`sub(c.x, (v) { seen <- v })`              // a child's / remote's cell

```
`sub `@pub `, (v) { lastPub <- v }`                 // own published cell
`sub #priv, (v) { lastPriv <- v }`              // own private handler
```

`sub c.pub(p: 100), (v) { last <- v }`           // parameterized: args after the subject

`sub #parameterized(p: 10), (v) { lastA <- v }`

`sub(abc, &fn)`            // or pass a function reference (local or remote)

- The first argument is fully-formed call.
- Then the lambda: its params bind each delivered re, and the body runs on the first delivery and on every later one.
- The spacious and lineal forms follow whatever over accepts. Check over's forms and mirror them; don't invent new ones.

**Retire the method form.** x.subscribe … becomes a parse error

(side effect: @subscribe becomes a valid public method name)

**Scope**

- **Parser:** add the keyword-first form, producing the same SubscribeCall AST (target, args, params, body), in both expression position and class-body position (today's ~5011 path, which routes class-body subscriptions to initBody). Remove the .subscribe parsing and add the retirement errors.
- **No codegen or wire changes are expected**, since the AST stays the same. If anything outside the parser reads SubscribeCall differently, find out why.
- **checkParamSubscribes** (src/validate.js, from a3dd51b) must still refuse subscribe(n) … on a function's own param.
- **Migrate the existing uses:** about 30 lines in 7 test files (grep -rn '.subscribe' __tests__), plus any in docs/ or notes/ examples. No .bv files use it.
- **Notes:** add a new note that supersedes the surface-syntax section and the "not a reserved keyword" bullet of notes/subscription-via-multi-re-2026-04-18.md, and add a pointer to it from that note. Don't rewrite the old note.

**Tests**, on js, rust and erlang:

- Each subject kind above: a class param (positional and named, & and *), a child's cell, own @pub, own #priv, and parameterized with args.
- A first delivery plus each later write: the existing subscribe and readonly_param live tests, migrated.
- Retirement errors for x.subscribe (v) {} and x.subscribe(p: 1) (v) {}.
- The parse error for subscribe(c.pub(p: 100)) (v) {}.
- A function subscribing to its own param is still a compile error.

**Open, decide during the ticket:** whether a bare subscribe with no params is allowed (sub(@pub ) { … }, which today is .subscribe { … } if that parses). Seems illegal. Subscribe to something but have no way to read it? If the subscription is really just a trigger, then it should require an explicit discard: `sub(@pub, (_) { effect }`
