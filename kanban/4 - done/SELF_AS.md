Should this special construction be allowed?

self as Type -> s // NO

Be consistent:

self as Type
  =
  ... calculations ...
  -> s

self as Type = -> s

This form not allowed:

self = -> { override }

Can't say you are something that you aren't.
