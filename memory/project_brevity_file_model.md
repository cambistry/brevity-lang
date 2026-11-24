---
name: brevity-di-model-injected-actors
description: "DI answers \"who can I talk to?\", not \"what can I build?\" A header entry injects an actor (instantiated if necessary); full notation is `*` or a typed `*`, omission is shorthand."
metadata:
  node_type: memory
  type: project
  originSessionId: 286cdca8-1721-4eaf-88bd-6380289b3d79
  modified: 2026-11-02T23:42:02.758Z
---

**DI is "who can I talk to?", not "what can I build?"** A header entry hands the file an actor, instantiated if necessary. Example: `HTML` is an actor that gets instantiated and injected; nobody constructs it. So in `"svc.bv": Svc`, `Svc` is already an actor, and `Svc.W()` is an ordinary message to it. Corrected by the user 2026-11-02; this replaces the earlier version of this memory, which said headers give "constructor bindings, not service references". That was wrong and sent a design discussion off-course again.

Full notation is an asterisk (generic actor type) or a typed asterisk:

```brevity
*
  :HTML *
  "/remote": R *
*
```

Omitting `*` is a shorthand that works at least in file actor headers and should probably generalize: the asterisk was judged noise (removed in `d00bc1f`, 2026-04-23), so an untyped header entry is assumed to be a messageable actor. `Svc *` no longer parses; don't treat restoring it as a to-do. The user notes this may have implications for header syntax, but work from what runs today.

`"thing.bv": Thing #` is the separate form the parser calls "actor constructor": `t = Thing(a: 5)` builds from it, using a manifest from `options.remotes`.

**Why:** `s = Svc()` on an injected binding reads wrong, since `Svc` is already instantiated. There are no class methods: `Svc.W()` isn't a static call, and a `W` class is something the actor `Svc` answers for.

**How to apply:** Don't describe a header binding as a constructor or a class. Older notes (`constructors-2026-03-24.md`, the `(Alias) <ctor-sig>` header shape) may describe the retired view; check against this before relying on them. Related: [[project_address_translation]].
