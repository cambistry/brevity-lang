import { compileSource } from '../helpers.js';

// What doesn't lex or parse is reported where it fails: a character the lexer
// has no token for, a token the file level can't start anything with, a `.` a
// named function's body can't hold.

describe('unexpected input', () => {
  it('a character with no token', () => {
    expect(() => compileSource('@f = -> $x\n')).toThrow("Unexpected character '$' (line 1)");
  });

  it('a character with no token, on a later line', () => {
    expect(() => compileSource('@f = -> 1\n@g = -> 2 ` 3\n')).toThrow("Unexpected character '`' (line 2)");
  });

  it('a carriage return is whitespace', () => {
    expect(() => compileSource('@f = -> 1\r\n@g = -> 2\r\n')).not.toThrow();
  });

  it('a token nothing at the file level starts with', () => {
    expect(() => compileSource('**\n@get = -> 1\n')).toThrow("Unexpected token at top level: STARSTAR '**'");
  });

  it('a leading `=`', () => {
    expect(() => compileSource('=\n@get = -> 1\n')).toThrow("Unexpected token at top level: EQUALS ''");
  });

  it('two statements on one line', () => {
    expect(() => compileSource('@go = {\n  x = 1 y = 2\n  return x\n}\n')).toThrow("Expected a line break or ';' after a statement, got IDENT 'y'");
  });

  it('two statements on one line, at the file level', () => {
    expect(() => compileSource('x = 1 y = 2\n@go = -> 1\n')).toThrow("Expected a line break or ';' after a statement, got IDENT 'y'");
  });

  it('a statement after a one-line function, on its line', () => {
    expect(() => compileSource('@go = -> 1 2\n')).toThrow("Expected a line break or ';' after a statement, got NUMBER '2'");
  });

  it('a `;` separates statements on one line', () => {
    expect(() => compileSource('@go = {\n  x = 1; y = 2\n  return x + y\n}\n')).not.toThrow();
  });

  it('a trailing `.` in a named function body', () => {
    expect(() => compileSource('@go = (n Integer) {\n  x = n\n  .\n}\n')).toThrow("Unexpected '.'");
  });

  it('a lone `&`', () => {
    expect(() => compileSource('@f = -> & 1\n')).toThrow("Unexpected character '&' (line 1)");
  });
});

// A list's items are separated, and a comma follows an item (found by mutation.test.js).
describe('unseparated input', () => {
  const C = 'U = (a Integer, b Integer) *{}\n';

  it('call args with no comma', () => {
    expect(() => compileSource(`${C}@f = {\n  u U = U(1 2)\n  return 1\n}\n`)).toThrow("Expected ',' between args, got NUMBER '2'");
  });

  it('a doubled comma in call args', () => {
    expect(() => compileSource(`${C}@f = {\n  u U = U(1, , 2)\n  return 1\n}\n`)).toThrow("Unexpected ',' in args");
  });

  it('list elements with no comma', () => {
    expect(() => compileSource('@f = -> [1 1, 2]\n')).toThrow("Expected ',' between list elements, got NUMBER '1'");
  });

  it('a leading comma in a list', () => {
    expect(() => compileSource('@f = -> [, 2]\n')).toThrow("Unexpected ',' in list elements");
  });

  it('a trailing comma is fine', () => {
    expect(() => compileSource('@f = -> [1, 2,]\n')).not.toThrow();
  });

  it('a doubled comma in params', () => {
    expect(() => compileSource('@f = (a Integer, , b Integer) -> a\n')).toThrow("Unexpected ',' in the list");
  });

  it('lineal params on one line with no comma', () => {
    expect(() => compileSource('@add\n  =\n  a Integer        b Integer\n  =\n  -> a + b\n')).toThrow("Expected a line break or ';' after a statement, got IDENT 'b'");
  });

  it('object elements with no comma', () => {
    expect(() => compileSource('@g\n  =\n  s = x: 5, y: 10 10\n  return s\n')).toThrow("Expected ',' between elements, got NUMBER '10'");
  });

  it('a reply opened with `(` and not closed', () => {
    expect(() => compileSource('@go = { return (7, 8 }\n')).toThrow("Expected RPAREN, got RBRACE");
  });

  it('a type declaration and the next one on its line', () => {
    expect(() => compileSource('type Sink(n: Integer) @go = -> 1\n')).toThrow("Expected a line break or ';' after a statement, got AT ''");
  });

  it('a type\'s fields with no comma', () => {
    expect(() => compileSource('type P(Integer y Integer)\n@go = -> 1\n')).toThrow("Expected a line break or ',' between fields, got IDENT 'y'");
  });

  it('a doubled comma in a type\'s fields', () => {
    expect(() => compileSource('type P(Integer, , Integer)\n@f = -> 1\n')).toThrow("Unexpected ',' in fields");
  });

  it('header entries on one line with no comma', () => {
    expect(() => compileSource('*\n  t Text      limit: Integer\n*\n@noop. = {}\n')).toThrow("got IDENT 'limit'");
  });

  it('a leading comma in a header', () => {
    expect(() => compileSource('*\n  , t Text\n  limit: Integer\n*\n@first = -> t\n')).toThrow();
  });

  it('a leading or doubled comma in a document', () => {
    expect(() => compileSource('use Svc = "svc.bv" as {, \n get () -> (Integer) }\n@f = -> 1\n')).toThrow("Unexpected ','");
    expect(() => compileSource('use Svc = "svc.bv" as (a: Integer) -> *{ get () -> (, Text) }\n@f = -> 1\n')).toThrow("Unexpected ','");
  });

  it('a stray token after a signature in an interface', () => {
    expect(() => compileSource('B = (inner { @get (key: Text) -> + (result: Text) }) *{}\n@f = -> 1\n')).toThrow("Unexpected PLUS '+' after '@get' in an interface");
  });

  it('`->` with nothing after it at the end of a constructor block', () => {
    expect(() => compileSource('C = *{\n  @a = -> 1\n  -> }\n@f = -> 1\n')).toThrow("'->' at the end of a constructor block has nothing after it");
  });
});

// A declaration needs its `=`. A name without one is a value: the block's own,
// which is one value, and never a function.
describe('a name with no `=`', () => {
  it('`f -> x` is a function value, which a block doesn\'t emit', () => {
    expect(() => compileSource('f -> true\n')).toThrow('Service block return-as value must not be a function');
  });

  it('`f (n Integer) -> x` is a call with no comma', () => {
    expect(() => compileSource('f (n Integer) -> n + 1\n')).toThrow("Expected ',' between args, got IDENT 'Integer'");
  });

  it('a lone name is a value, and has to be bound', () => {
    expect(() => compileSource('count42\n')).toThrow("'count42' is not defined (line 1)");
  });

  it('a block emits one value', () => {
    expect(() => compileSource('x = 1\nx\n\n2\n')).toThrow('A block emits one value: this one has two');
  });

  it('a lineal body that opens with `@` is a function body', () => {
    expect(() => compileSource('Box\n  =\n  @label = -> "x"\n')).toThrow('Unexpected token in function body: AT');
  });

  it('`name = *Type` takes the type\'s args', () => {
    expect(() => compileSource('Box = (v Integer) *{ @v = -> v }\nb = *Box Box(42)\n@go = -> 1\n')).toThrow("Expected LPAREN, got IDENT 'Box'");
  });

  it('a subscript glued to its value', () => {
    expect(() => compileSource('@f = (xs List) -> result: xs[0]\n')).not.toThrow();
  });

  it('a `[` after a space is not a subscript', () => {
    expect(() => compileSource('@f = (xs List) -> result: xs [0]\n')).toThrow("Expected a line break or ';' after a statement, got LBRACKET ''");
  });

  it('two lists with no comma between', () => {
    expect(() => compileSource('@f = -> result: [[1, 2] [3]]\n')).toThrow("Expected ',' between list elements, got LBRACKET ''");
  });
});
