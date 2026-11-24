---
status: investigation
created: 2026-11-21
---
# Opre generics

This is foundational for the broad “predicate” concept.

An Opre type is representable as generic, i.e. can contain/modify other types. Proposed wire syntax:\

{ op: [[1, “one”], “exec”], ty: [[Integer, Text, {“%t”: “Set“}]] }

or with named parameters:

{ op: [[{target: “test”}], “go”], ty: [[{target: “Text”, “%t”: “Tagged“}]]

“%t” is a reserved field name, but note: only for generics. If it is actually a field in the data, then it does not process as a generic.

“%t” is provisional. Alternatives might be “%gen”, “%g” or just a plain glyph.
