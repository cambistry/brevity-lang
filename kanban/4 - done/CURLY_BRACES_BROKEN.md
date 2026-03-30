Something is really broken with curly brace lambda syntax.

double = |n : Integer| { n * 2 } : Integer

Doesn't work.

@inc = |:x : Integer| {
  bigger = x + 1
  -> :bigger as Integer
}

Doesn't work.

AND SOMEHOW THIS DOES:

      @nullVar    = x : Integer | null = null          -> result: x
      @nonNullVar = x : Integer | null = 42 as Integer -> result: x

THIS PASSES??

@inc = x <- x + 1 -> :x
