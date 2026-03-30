Could Brevity nest actor field scopes -- with the possibility that inner scopes are themselves actors?

Brevity has deliberately avoided curly braces to discourage deep nesting, so maybe this is a good thing. Nonetheless:

a = A()
a::field <- value
a::field! key: updated_value

This is fairly expressive on the consumption side, built off of the allocation of `a` to begin with. And what if ::field is not a scalar value but itself an actor?

a = A()
a::child::field <- value

Nothing wrong with that IMO. And also possible that a::child could be passable:

ref a = A()
pass(&a::child)

That's a capture of a contained stable reference, and therefore of the outer reference itself. (The expression actually communicates that nicely.)

ref a = A()
ref c = a::child
pass(&c)

Interesting.

Now back to the definition problem.

actor A
  init
    ref @field = Field() // ref makes it unrebindable
    ref @int = Integer(0)
    @zero = 0

  ::field -> @field
  ::int -> @int
  ::zero -> @zero // no setters. forever zero.

  ::inline -> actor {
    // actor, anonymous type
    init() @value = "hello" . // hosted by
    get() -> @value
    set(val) @value = val .
    update(:case)
  }() // parens to invoke the constructor. looks messy!
end#A

actor Field
...
// could have :: subfields
