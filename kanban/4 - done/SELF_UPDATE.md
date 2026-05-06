update = (k: v) { <change state> } // closing dot not required
update = (val) ->  k <- val .
update
  =
  ...args
  =
  <change state>
  .

Usage:

actor <| ...args

It is an effectful update-in-place that implicitly returns self
