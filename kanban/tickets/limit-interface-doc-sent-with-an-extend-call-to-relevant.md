---
status: todo
created: 2026-11-21
---
# Limit interface doc sent with an $extend call to relevant names

A child class might produce public or protected names that are not referenced by the parent or any ancestor. There is no reason to list these in $extend, since they are not overrides that need to be checked. Since the child has the public/protected interface of the parent, it can, and only needs to, report overrides.
