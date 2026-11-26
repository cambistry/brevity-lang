---
status: in-progress
created: 2026-11-26
---
# Encode types before the parse-time lowerings

Some lowerings run inside the parse (src/parser.js, after the program is read), before src/parser_types.js encodes its types: src/singleton_classes.js, src/super_calls.js, src/base_layers.js, the block delegation, the self chains. They hand type text along for the encoder, so for that stretch a type is text, an encoding, or both:

- `typeOfParam` / `typeOfCell` and the `RemoteNew` args in src/super_calls.js carry whichever form a param has.
- `encodedLater` getters and the lazy `forwardCells` types in src/singleton_classes.js.
- `inheritedIngests` in src/subclass.js carry `typeName` when it's there.

A lowering there that reads an encoding gets `undefined` with no error. That's how super-arg cells came out typed `Anything` while ticket 6 was in progress.

Encoding can't simply move first: names resolve against the file's classes, and these lowerings change them (singleton classes, class blocks' `membersOf`, remote parent stubs). Preferred approach: each lowering builds its types encoded, resolving names through the parser's resolver (`ast.typeNamed`), keeping today's pass order. If that tangles in src/singleton_classes.js, the alternative is to encode each type once its scope is settled; that is a design decision, not a default.

Then remove the text these lowerings carry and the lazy getters.

No output changes (the corpus of test programs compiles byte-for-byte the same on every target). Done when no node holds type text at any point after the type grammar reads it, and the full suite is green.
