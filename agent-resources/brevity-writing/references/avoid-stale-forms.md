# Avoid Stale Forms

This pack is intentionally conservative. Avoid these moves unless the app has a
clear, current reason to use them.

## Prefer These

- Prefer the top-level `< ... >` dependency header.
- Prefer explicit service interfaces in dependency declarations.
- Prefer named constructor arguments for remote instances.
- Prefer public handlers that clearly show request and reply flow.

## Avoid These

- Avoid older dependency vocabulary such as `uses` when writing new examples.
- Avoid bare dependency refs without an interface contract.
- Avoid mixing public API terminology like `interface` and `manifest` in the same explanation.
- Avoid describing cluster infrastructure as solved by Brevity alone.
- Avoid relying on prose notes for wire semantics when writing app-facing examples.

## Messaging Boundary

When describing the project around code examples:

- Brevity is for the application layer of cluster applications.
- CAM provides the actor/message model.
- Adjacent infrastructure such as discovery, edge establishment, and crypto may exist outside the Brevity file itself.

## Practical Rule

If you are tempted to use a form that is more compact, more magical, or more novel than the examples in this pack, do not. Choose the more explicit form.
