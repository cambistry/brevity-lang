((x) ->  x + 1)(1) => 2
{ ... }() // run block
{ ... }(1) // error - raw block has no params
x = { effect . }() // error. no-return block cannot be assigned

a = ((x) ->  $x = x .)(1) // compiler error
a = {$x = x .}() // compiler error
