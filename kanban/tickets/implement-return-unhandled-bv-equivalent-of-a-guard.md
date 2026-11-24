---
status: inbox
created: 2026-05-13
---
# implement return `unhandled` - BV equivalent of a guard

May not be called after any effectful call or update.

(Unless wrapped in a transaction and rolled back – later feature. But this is pretty damn edgy!)
