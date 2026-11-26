---
status: investigation
created: 2026-11-25
---
# Investigate `Type?` for nullable

`carrying *Text? = null` in `kanban/speculative/board.bv`: `T?` means `T | null`. Check that it parses, and conflicts with nothing, in every position a type appears:

- cell and local declarations (`x *Text?`, `x Text?`), with `?` binding to the type name, tighter than `*` (`*Text?` is a cell of a nullable Text);
- params, named and positional (`(t Ticket?, n: Integer?)`), and in interface documents;
- the header return type (`(…) : Text? { … }`);
- generics and unions (`List[Text?]` against `List[Text]?`, `Text? | Integer`);
- `as` beside `??` (`x as Ticket?? y` lexes as `???`: require a space or parens);
- the lexer: `?` already ends predicate names (`empty?`), so `Text?` lexes as one name; split it only for a capitalized name in a type position;
- **the existing optional-field prefix**, `type User (id Text, ? nickname: Text)` (`__tests__/types/type_named_construction.test.js`): optional (may be absent) and nullable (present, may be null) are different, and `? nickname: Text?` must read clearly;
- the opre type encoding and service documents.
