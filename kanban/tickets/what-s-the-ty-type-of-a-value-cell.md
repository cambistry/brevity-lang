---
status: inbox
created: 2026-11-03
---
# What's the 'ty' type of a value cell?

Assuming that the cell is being exposed by address, rather than by value.

Tempting to just add the asterisk:

{ ty: ‘*Integer’ }

However this implies an implementation-specific interface, i.e. what functions does this expose beyond `set`?

If we confined the operations to `set`, then *Type might actually suffice.
