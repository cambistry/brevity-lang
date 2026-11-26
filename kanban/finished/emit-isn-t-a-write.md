---
created: 2026-11-04
---
# emit isn't a write

Design: notes/emit-not-a-write-2026-11-03.md. This reverses the settled "emit counts as a write" in notes/mutation-suffix-2026-10-31.md.

An emit sets nothing. Subscribers opted in, and their handlers answer for what they set, since an on handler that writes already counts as a write in its own actor. So an emit doesn't make the emitting function a writer, just as .subscribe doesn't.

**Already** **done** (effect-rules ticket): for the fresh-actor exemption, an emit doesn't reach past the actor. w = W(); w.fire!(), where fire! only emits, isn't a write for the caller.

**To** **do:**

- **src/effects.js:** an emit no longer calls scope.write anywhere: in function bodies (naming), in constructor blocks, and in local functions. It currently skips only in the reach pass (reachOnly). Once all of these skip it, remove that flag.
- **Rule 7 fallout:** a ! function whose only "write" is an emit becomes "never writes". Rename those functions in tests and fixtures, e.g. in keywords/emit.test.js, types/type_interface.test.js and classes/dependency_injection.test.js. Grep for emit in __tests__. A class named ! whose constructor only emits needs the same treatment.
- **Generated docs:** a function that only emits documents as ->, not =>. Check docs / extract for emit-driven arrows.
- **Doc arrows for emits:** emit fired(…) => . in a declaration uses =>. Decide whether an emit declaration's arrow should become ->, or stay as notation for "subscribers may act". This is the one open question.
- **Tests:** a function that only emits takes no ! and compiles; a ! function that only emits is an error; an on handler that writes still counts as a write in its own actor; a constructor block that emits doesn't need !.
- **Notes:** notes/mutation-suffix-2026-10-31.md, "What counts as a write", should list emit under "Not writes", next to .subscribe.

Out of scope: how transactions treat writes in subscribers that an event sets off. The suffix can't show those, so the transaction work has to track them itself.
