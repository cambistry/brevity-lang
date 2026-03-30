This has been a good discussion in relation to the marshaling (capture/hydrate) epic. There is no reason to capture "variables" that aren't actually refs (actors) or have been declared with `ref`. Those can never change in any way that means anything functionally. I think that means that we should have no `var` statements at all in the JS transpile. Everything is a const.

Yes. In a functional actor model, a non-ref binding is immutable by definition. The only things that change are refs (process dictionary entries / private fields that go through <- / <| handlers) and child actors. Everything else is a derived value computed during handler execution — it exists only for the duration of that dispatch and is gone.

Making everything const in the JS transpile is the honest representation. The current let emissions for rebinding (x = 1; x = 2; x = 3) are a JS convenience that shouldn't exist — Erlang already enforces this with SSA (X, X__1, X__2). JS should do the same: each rebinding is a new const with a suffixed name, or the rebinding pattern should be a compile error.

This also simplifies capture: you only serialize what's in the ref set. No ambiguity about which locals matter.
