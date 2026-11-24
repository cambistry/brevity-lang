---
status: done
created: 2026-11-08
---
# JS: a type in an instance's reply is tagged with the instance as its authority

  **Problem.** A ty tag names a type and its authority: the actor whose declaration of the type is meant. Types can only be declared at the top of a file, so a type's

  authority is always a file actor. On Rust and Erlang, a public class instance's reply tags a type of its file as ::Point, relative to the file actor. JS tags the

  same reply \@W/1 ::Point, which says the instance W/1 declares Point.

‌

  brevity

  // [svc.bv](http://svc.bv "‌")

  ::Point (x Integer, y Integer)

‌

  \@W = *{

    \@get = { return Point(1, 2) }

  }

‌

  ┌──────────────┬───────────────────────────────┬───────────────────────────┐

  │    Target    │ Reply to \@get, leaving [svc.bv](http://svc.bv "‌") │ As the caller receives it │

  ├──────────────┼───────────────────────────────┼───────────────────────────┤

  │ Rust, Erlang │ ty: ['::Point']               │ ty: ['Svc ::Point']       │

  ├──────────────┼───────────────────────────────┼───────────────────────────┤

  │ JS           │ ty: ['@W/1 ::Point']          │ ty: ['Svc \@W/1 ::Point']  │

  └──────────────┴───────────────────────────────┴───────────────────────────┘

‌

  **Cause.** #_publishInstance in src/codegen/javascript/classes.js translates what an instance sends, as a parent does. Its localTy puts the instance's address in front

  of every relative tag. That's right for an instance's own sub-actors, but a type tag doesn't name a sub-actor: the instance only uses a type its file declares. Rust

  and Erlang get it right because the file actor writes the reply that goes on the wire, so their tags are already relative to the file.

‌

  **Why** **it** **hasn't** **shown** **up.** When decoding, every target strips the authority and matches on the bare type name (bareName on JS, bv\_type\_name on Rust and Erlang). It

  will break once authority is checked, for example when two files each declare a ::Point with different fields, or when type identity becomes the path plus a content

  hash. Then Svc \@W/1 ::Point won't match Svc ::Point. This was deferred as point 5 of notes/session-2026-11-03-ty-without-brackets.md.

‌

  **Fix.** In localTy, leave a type tag (one containing ::) relative to the file actor, as Rust and Erlang do, rather than adding the instance's address. The bare \@ ("my

  class") stays as it is, and so does address translation in re and op.

‌

  **To check while there:**

- **A class tag for another of the file's classes.** If W/1 returns a Box actor, does JS tag it \@W/1 @box? The class is the file's, so its authority should be the file,

    like a type's. Check what Rust and Erlang send and settle on one rule for all tags an instance writes.

- **Instances below the top level.** An instance constructed by another instance, or a class nested inside a class (notes/session-2026-11-07-enclosing-actor-chain.md),

    passes through more than one parent. Check that each parent leaves a type tag pointing at the file, not at itself.

‌

  **Out of scope, related.** The same type can also be spelled [svc.bv](http://svc.bv "‌") ::Point, which names the authority by its path: the caller writes this form when it sends the type

  back. Whether Svc ::Point and [svc.bv](http://svc.bv "‌") ::Point should become one form is part of the authority-checking design, not this fix.

‌

  **Done when:**

- A type value in a public class instance's reply has the same ty on JS, Rust and Erlang: ['::Point'] leaving the file, ['Svc ::Point'] at the caller.

- Tests assert the reply's exact ty on all three targets. Use the relay in "end to end: type values cross to and from a class in another file", in

    \_\_tests\_\_/classes/public\_class\_across_files.test.js, and include a type nested in a reply (return (p: Point(1, 2), n: 1)).

- The class-tag question is answered, and fixed or written up.

- Point 5 in notes/session-2026-11-03-ty-without-brackets.md is marked done.
