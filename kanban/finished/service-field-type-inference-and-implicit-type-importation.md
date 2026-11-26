---
created: 2026-10-27
---
# Service field type inference and implicit type importation

1. When using a service, the type of a service field should be (optionally) inferable from the service definition.
2. If the type of a field is not defined locally, the definition should be implicitly imported.
3. However, this does not make that type available in the entire local context – only in relation to the immediate reference.

The immediate use case is onclick etc.

<div… onclick=e->{e.stop! …} …>

`e` is inferred to be an HTML::Event because of the imported definition of <div>. This could be optionally expressed as:

<div… onclick=(e Event)->{e.stop! …} …>

However this explicit reference to Event should require explicit importation of that type in DI.
