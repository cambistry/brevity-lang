# CAM / Interop

LLM orientation: this directory documents tested CAM boundary behavior. Prefer
these tests when writing about cross-actor calls, remote dependencies, actor
construction, callback flow, and outgoing wire messages.

## Current Tested Model

- Dependencies are declared in the file-level `*( ... )` header.
- A dependency entry binds a path or name to a local alias: `"Remote": (Remote)`.
- Inline service constraints are the safest examples:
  `"Remote": (Remote) { get: (:url Text) -> (:response Text) }`.
- Calls to dependency aliases send CAM messages to the alias address.
- Replying calls suspend the current continuation until a matching `re` arrives.
- Silent calls use `spawn` or a silent `-> .` surface and do not produce a value.
- Source form for a remote actor binding: `view = *Name(...)`. Construction
  calls the remote class — a `#new` message is sent to the dependency address;
  the reply carries the actor's address.

## Important Tests

- `external_send.test.js`: a dot call to a declared dependency sends an outgoing
  CAM message, then resumes on reply.
- `interop.test.js`: request/reply, silent cross-actor calls, three-actor chains,
  and callbacks.
- `remote_instance.test.js`: `*Name(...)` sends `#new`; the returned
  `#<Type/id>` address is used for later method calls on the actor.

## Boundaries

- Do not describe remote interop as a separate RPC subsystem.
- Do not imply discovery, cluster routing, or transport security are solved by
  these language tests.

## Documents

- [Remote Interop](interop.md)
- [Remote Actors](remote_instance.md)
