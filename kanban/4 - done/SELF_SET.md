Current syntax:

@ <- (v) val = v .

New syntax:

@self <- (v : Type) val = v .

or

@self <-
  =
  v : Type
  =
  val = v
  .

Can also be a private function (or both!!)

self <- (v : Type) val = v .

etc.

Function overloading works:

@self <- (i : Integer) ...
@self <- (t : Text) ...
@self <- (s : type of self) ... // ???? `type of self` ?

Tempting to allow :: as shorthand for `self`, but maybe not in v1.

Pending question: should `self` return be implicit in effectful operations? Specifically set and update?
