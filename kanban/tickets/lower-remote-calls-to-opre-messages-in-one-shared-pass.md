---
status: done
created: 2026-11-11
---
# Lower remote calls to Opre messages in one shared pass (fixes Svc.s.get())

**Problem**

The compiler has no Opre layer. JS, Erlang and Rust each build the address of a remote call themselves, by matching on what the receiver is:

- a dependency alias gives to: "Svc";
- a cell typed with a class gives a per-actor dispatch;
- a local holding an address takes a third path.

A receiver that matches none of these falls through. The cross-file call Svc.s.get(), where @s is a public singleton in Svc, compiles on JS to #send("@get", undefined). Erlang and Rust are untested for it. The addressing logic exists three times, and each new kind of receiver has to be added three times.

**Fix**

Add one front-end pass that lowers every remote call to an Opre message before codegen runs. The message has three parts:

- **Address:** the member path becomes space-delimited tokens. Svc.s.get() gives the address Svc @s, and Svc.s.inner.ping() gives Svc @s @inner. A public member .x is wire @x.
- **Op:** the last member, in the form each target emits today. This ticket doesn't change what an op contains.
- **Arguments:** argument slots with their ty, as each target already builds them.

The pass attaches the lowered message to the call node. Each target sends that message and no longer works out the address itself.

The pass covers every receiver shape, not just the new one:

- dependency aliases;
- dot chains through sub-services (public singletons, nested to any depth);
- cells holding actors, whether a class's actors or a singleton;
- locals holding an address, including one bound from a sub-service (x = Svc.s; x.get());
- the actor's own published singletons (@s.get()).

Once every target reads the lowered message, delete the per-target branches that derive the address.

A target may still choose how to deliver a message: in-process or over the wire, a direct call or a send. Only the address has to come from the lowered message.

**Checking (a separate pass over the same lowered calls)**

- Resolve each call against the dependency's service document, walking __services for sub-services and __types.X.services inside classes.
- Report errors for an unknown sub-service, an unknown member, and an arity or type mismatch, in the same style as the existing service-call errors.
- A call through a sub-service gets its return type from the document. The result is not Anything.

**Out of scope**

- Moving to the token format in notes/opre-addresses-as-tokens-2026-11-11.md (for example Box /1). Addresses keep their current wire form, such as @Box/1 @tally.
- What an op contains, and local messaging.
- The local/global rule. A leading delimiter still means local and a leading word character still means global; it doesn't change.
- How a service document names a returned actor (-> (Anything)), which is still open.

**Acceptance**

- On JS, Erlang and Rust, a two-file test in the style of __tests__/classes/singleton.test.js, with literal expectBehavior steps, shows that:
- Svc.s.get() sends to: "Svc @s", op @get, and gets back the value;
- a nested sub-service (Svc.s.inner.ping()) works the same way;
- an address bound from a sub-service, then called, works the same way;
- a sub-service inside a class actor works the same way;
- unknown sub-service and unknown member calls fail to compile with clear errors.
- The existing singleton, service and class tests pass unchanged on all three targets. The wire messages they produce are the same, byte for byte.
- The address-deriving branches in src/codegen/{javascript,erlang,rust} are gone, and the lowered message is the only source of to for a remote call.
- Design notes for the pass go in notes/.

**Pointers**

- JS: the #send call sites in src/codegen/javascript/.
- Erlang: bv_forward_, bv_instance_at_ and bv_instance_from_ in src/codegen/erlang/preambles.js.
- Rust: routing and isStateChildCall in src/codegen/rust/.
- Service documents: parseInterface / parseConstructor (__services, services) in src/codegen/javascript/types.js.
