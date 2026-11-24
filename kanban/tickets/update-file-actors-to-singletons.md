---
status: done
created: 2026-11-11
---
# update file-actors to singletons

Unlike inline singletons, file singletons may accept a DI header. Either lineal or delimited notation works.

This ticket will migrate essentially EVERY bv file in the project, excepting any that are already intended as factories, if there are any.

This may obsolete or modify the # notation used to specify non-singleton DI entries (i.e. access to a class that responds to #new).
