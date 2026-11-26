---
created: 2026-05-06
---
# Revisit &, *, ! scalars etc

We have gone back to asterisk for scalar ref cells.

with two sigils for params, to request specific capabilities.

```
fn = (list List) {} // by val
fn = (list &List) {} // by ref, read-only
fn = (list *List) {} // by ref, read/write request
C = *(list *List) {} // constructor
```

invocation:

```
list *List = []
fn(list) // read-only or by-val
fn(*list) // read/write. note prefix position.
```

Asterisk is the mutability grant. Without asterisk, is passed by ref or by val depending on param declaration. (i.e. has an &) If the signature params include an asterisk, then this must be provided when called to pass that capability. For the moment, this convention should only apply to types: both core types and application-defined. No change to object call permissions.
