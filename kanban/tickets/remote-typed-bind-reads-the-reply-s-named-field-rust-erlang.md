---
status: done
created: 2026-10-29
---
# Remote typed bind reads the reply's named field (rust, erlang)

  x T = remote.m() should bind the reply's single unnamed value. On rust and erlang it reads the reply's named field x

  instead. That's the reverse of the fallback removed in c6fe13e.

‌

- **Where:**

- rust: handleTypedAssign\_DotCallExpr in src/codegen/rust/statements.js (\_re.get(s.name))

- erlang: the remote needsAwait branch of the typed-assign code in src/codegen/erlang/statements.js

      (maps:get(s.name, Tmp_named, null))

- **Fix:** take the single unnamed value, like the js BvObject.one path and the child-actor paths.

- **Also check:** js isChildSend in an implicit return falls back to named[methodName], which is the same kind of

    leniency.

- **Tests:**

- a remote method returning an unnamed value binds with x T = r.m();

- a remote method returning only x: … binds with :x T = r.m().
