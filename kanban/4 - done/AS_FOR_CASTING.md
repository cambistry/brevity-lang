Feels overloaded.

a : Integer // declaration

-> a : Float // contextually understandable, but maybe confusing

a : Float // is this a conflicting declaration? I guess so...

It's unclear if a typed return value ought to be re-typed.

-> a : Float

... but `a` is already something!

The reason for this construction is to be able to easily produce function signatures.

I think `as` is more honest and can accomplish the same thing.





