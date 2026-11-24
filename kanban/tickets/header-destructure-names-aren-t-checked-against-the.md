---
status: done
created: 2026-11-10
---
# Header destructure names aren't checked against the dependency's manifest

When a dependency has a manifest (written inline or passed in options.remotes), an explicit destructure entry like HTML: (:sytle) or "svc.bv": (:gret) is accepted even if the manifest doesn't declare that name. The manifest is only read to expand a spread .... The results:

- A typo'd tag compiles, and the runtime quietly creates an unknown element.
- A typo'd op compiles and routes to a missing endpoint.
- A typo'd type import (:Pont instead of ::Point) silently becomes a remote actor construction instead of a typed value.

Fix: after the spread expansion, check each entry's remote name against the manifest's ops, classes and types, and throw 'X' is not exported by 'Alias' with the available names listed. Add tests for a tag, an op, a type and an aliased entry (gret: g).
