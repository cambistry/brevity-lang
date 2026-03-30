For brace functions, if the last statement evaluates silently, the entire funtion is silent

fn = { x <- x + 1 } // implicit silent return

Question: should this form be illegal:

fn = -> x <- x + 1

i.e. using the return operator to point to silence?

If so, we should also deprecate `-> .`

A silent function would need to either have vertical bar args or curly braces (since the -> is eliminated). Seems fine to me.
