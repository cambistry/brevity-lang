The idea is to unify the meaning of curly braces across lambdas, blocks, and at least singleton actors.

Core insight: when you call a function with args, it is like you are instantiating with a constructor.

{ (args) ->  body }

A function body is a little actor, in a way, especially noticable when concurrency comes into play. The function call has a lifespan and "dies" later when its job is done.

So, suppose an "actor" were initialized like this.

(params) {
  ref val = 0 // initialization

  // declare an interface
  get() -> val
  set(v) val = v .
  op work!(args) -> apply!(val, args)

  ::child -> { ... }()

  priv op apply!(v, args) -> ...

  self // !
}

That last line is key. It means that whatever calls this constructor gets a durable reference to the concurrent process. It is a reference to this *specific* invocation of this function.

The process persists as long as there is a reference being held, and `self` can now receive messages.

Of course this collapses to a basic lambda:

(a) {
  <body>
  <return>
}

Which collapses to a block (just a lambda with no args):

{
  ...
  <return>
}

Which collapses to a single expression.

(x + 1) // note that this is a closure as well

Or an expression with initializer:

(x) ->  x + 1

Going the other direction, a bare file actor can simply be viewed as a function body with no init params (though that is not a hard no).

```
ref mine = Integer(0)
op operate() ...
```

Seems like an actor type definition is just a named function definition:

```
uses Printer

public actor MyActor
  :name : Text
  :value : Integer

  ref x = value

  // get
  pub self as Integer -> x
  pub self as Text -> Text(x)

  // set
  pub self <- (_x : Integer) x <- _x .

  // print
  pub print()
    Printer.print(self as Text)
    .

  self
```

```
uses Printer

public actor MyActor(:name : Text, :value : Integer) {
  ref x = value

  // get
  pub self as Integer { x }
  pub self as Text { Text(x) }

  // set
  pub self <- (_x : Integer) { x <- _x . }

  // print
  pub print() { Printer.print(self as Text) . }
} // `self` returned
```

```
pub actor A
