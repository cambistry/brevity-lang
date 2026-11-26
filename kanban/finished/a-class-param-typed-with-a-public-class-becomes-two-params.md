---
created: 2026-11-10
---
# A class param typed with a public class becomes two params

@U = (b @Box) *{} is supposed to declare one positional param b of class @Box. Instead it renders in the interface as:

```
{
  Box () -> *{}
  U (Anything, Anything) -> *{
    Box Anything
  }
}
```

The named form (b: @Box) gives exactly the same output.

_Cause._ The class-param parser does not accept @Box as a type. It reads b as an untyped param and stops. It then reads @Box as a second, published param (@name …, src/parser.js ~3376). That param gets accessor Box and type Anything, which is where the field Box Anything comes from. The params AST shows it:

```
[{"name":"b","type":null,"positional":true},
 {"name":"Box","type":"Anything","positional":true,"accessor":"Box"}]
```

There is no comma between the two, but the parser still accepts a second param. With a private class it works: Box = *{} and @U = (b Box) *{} render U (Box) -> *{}. No parent class is involved, so this is not from the ++ change.

_Expected._

- (b @Box) and (b: @Box) each give one param typed @Box. The rendering should follow whatever rule applies to public class names elsewhere in interfaces (bare Box there today).
- A param list with no separator between two params is a parse error, not two params.

_Tests._

- Add cases to __tests__/services/subclass_interface.test.js next to the private-Box case in "++ forms", or to the class-params tests. Cover both spellings, the interface render, and the constructed actor answering with the right value.
- Once fixed, switch the private-Box test back to @Box, or keep both.
- Cover js, rust and erlang.
