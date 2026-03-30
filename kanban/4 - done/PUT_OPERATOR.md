actor A
  init(val : Integer)
    $val : Integer = val .

  as Integer -> $val

  on <- (val : Integer)
    $val = val .
end#A

ref a = A(0)
a <- 1
b : Integer = a
-> b // Integer

Works for any arguments:

actor B
  init(pos : Integer, :named : Text)
    $pos = pos
    $named = named .

  on <- (repos : Integer, :renamed : Text)
    $pos = repos
    $named = renamed .

  on pos()
    -> $pos

  on named()
    -> $named
end#B

ref b : B(10, named: "ten")
b <- 11, named: "eleven"
b.pos() == 11
b.named() == "eleven"
