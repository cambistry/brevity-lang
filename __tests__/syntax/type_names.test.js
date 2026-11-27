import { compileSource } from '../helpers.js';

// Every name in type position is a type, or it's `'X' is not a type`
// (src/type_names.js). Types read with the type grammar, so a function type's
// field names aren't types and `of`, `|`, `::` parts are.

const compiles = (src, options) => expect(() => compileSource(src, options)).not.toThrow();

const SVC_DOC = {
  public: { origin: [{ re: [':Point'], writes: false }] },
  types: { ':Point': [{ x: 'Integer' }] },
  ':Counter': {
    public: { $new: [{ args: ['Integer'], re: [':Counter'], writes: false }] },
    instance: { public: { get: [{ re: ['Integer'], writes: false }] } },
  },
  ':W!': {
    public: { $new: [{ re: [':W!'], writes: true }] },
    instance: { public: { one: [{ re: ['Integer'], writes: false }] } },
  },
};
const remotes = { remotes: [{ path: 'svc.bv', service: SVC_DOC }] };

describe('a name that is not a type', () => {
  it('in an annotation', () => {
    expect(() => compileSource('x Thnig = 1\n@f = () -> 1\n')).toThrow("'Thnig' is not a type");
  });

  it('a retired type name', () => {
    expect(() => compileSource('echo = (c Class) -> c\n@f = () -> 1\n')).toThrow("'Class' is not a type");
  });

  it('a bang name', () => {
    expect(() => compileSource('x Integer! = 1\n@f = () -> 1\n')).toThrow("'Integer!' is not a type");
  });

  it('in an `as`', () => {
    expect(() => compileSource('@f = () -> 1 as Thnig\n')).toThrow("'Thnig' is not a type");
  });

  it('after `of`', () => {
    expect(() => compileSource('@f = (xs List of Thnigs) -> 1\n')).toThrow("'Thnigs' is not a type");
  });

  it('in a union', () => {
    expect(() => compileSource('@f = (x Integer | Thnig) -> 1\n')).toThrow("'Thnig' is not a type");
  });

  it('in a function type', () => {
    expect(() => compileSource('@f = (cb (n: Integer) -> (Thnig)) -> 1\n')).toThrow("'Thnig' is not a type");
  });

  it('a public class named bare', () => {
    expect(() => compileSource('@Pub = *{}\n@go = (p Pub) { return 1 }\n')).toThrow("'Pub' isn't in scope — the public class is '@Pub'");
  });

  it('through a dependency whose document doesn\'t declare it', () => {
    expect(() => compileSource('use Svc = "svc.bv" as { n () -> (Integer) }\n@f = (p Svc::Point) -> 1\n')).toThrow("'Svc::Point' is not a type");
  });

  it('in a constructor profile', () => {
    expect(() => compileSource('use Svc = "svc.bv" as *(n: Nope) -> { get () -> (Integer) }\n@f = () -> 1\n')).toThrow("'Nope' is not a type");
  });

  it('in a document written here', () => {
    expect(() => compileSource('use Svc = "svc.bv" as { n () -> (Pointt) }\n@f = () -> 1\n')).toThrow("'Pointt' is not a type");
  });
});

describe('a type is', () => {
  it('a builtin', () => compiles('@f = (n Integer, t Text, b Boolean) -> 1\n'));
  it('a builtin plural after `of`', () => compiles('@f = (xs List of Integers) -> 1\n'));
  it('a union with null', () => compiles('@f = (x Integer | null) -> 1\n'));
  it('a function type, its field names aside', () => compiles('@f = (cb (n: Integer) -> (r: Text)) -> 1\n'));
  it('a cell\'s type', () => compiles('n *Integer = 1\n@f = () -> n\n'));
  it('a `type` the file declares', () => compiles('type Point(Integer)\n@f = (p Point) -> 1\n'));
  it('a declared type after `of`', () => compiles('type Point(Integer)\n@f = (ps List of Point) -> 1\n'));
  it('a class', () => compiles('C = *{ @ping = () -> 1 }\n@f = {\n  c C = C()\n  return c.ping()\n}\n'));
  it('a public class, as `@C`', () => compiles('@Pub = *{}\n@go = (p @Pub) { return 1 }\n'));
  it('a writing class, without its `!`', () => compiles('use Log = "log.bv" as { note. () => . }\nW! = *{\n  Log.note...\n  @one = () -> 1\n}\n@f! = {\n  w W = W!()\n  return w.one()\n}\n'));
  it('`class`', () => compiles('C = *{\n  @peer *class | null = null\n  @f = () -> 1\n}\n@g = () -> 1\n'));
  it('a type a dependency\'s document declares, through it', () => compiles('use Svc = "svc.bv"\n@f = (p Svc::Point) -> p.x\n', remotes));
  it('a class a dependency\'s document declares, bare', () => compiles('use Svc = "svc.bv"\nread = (w Counter) { return w.get() }\n@f = () -> 1\n', remotes));
  it('a type a document written here declares', () => compiles('use Svc = "svc.bv" as { type Point(x: Integer)\n  n () -> (Point) }\n@f = (p Svc::Point) -> 1\n'));
  it('in a constructor profile', () => compiles('use Svc = "svc.bv" as *(n: Integer) -> { get () -> (Integer) }\n@f = () -> 1\n'));
});
