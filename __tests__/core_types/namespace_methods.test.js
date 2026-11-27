import { compileSource } from '../helpers.js';

// A builtin namespace (`Text`, `Blob`, `GraphemeText`, `List`, `Math`, `Integer`,
// `Float`, `Decimal`) called by name answers only its own methods. A name the file
// binds itself — a dependency, an actor, a param, a local — is that binding instead.

describe('namespace methods — what a builtin answers', () => {
  it('a method the namespace has', () => {
    expect(() => compileSource('@go = () -> Text.upper("hi")\n')).not.toThrow();
  });

  it('a method it does not have', () => {
    expect(() => compileSource('@go = () -> Text.nope("hi")\n')).toThrow("'Text' has no method 'nope'");
  });

  it('in an assignment', () => {
    expect(() => compileSource('@go = {\n  x Text = Text.nope("hi")\n  return x\n}\n')).toThrow("'Text' has no method 'nope'");
  });

  it('on a number namespace', () => {
    expect(() => compileSource('@go = () -> Integer.nope(1)\n')).toThrow("'Integer' has no method 'nope'");
  });

  it('a bang is part of the name', () => {
    expect(() => compileSource('@go! = {\n  t *Text = "hi"\n  x Text = Text.upper!(t)\n  return x\n}\n')).toThrow("'Text' has no method 'upper!'");
  });
});

describe('namespace methods — a name the file binds', () => {
  it('an actor named like a namespace', () => {
    expect(() => compileSource('Math = actor {\n  @double = (n Integer) -> n * 2\n}\n@go = { return Math.double(2) }\n')).not.toThrow();
  });

  it('a param named like a namespace', () => {
    expect(() => compileSource('@go = (Math Integer) -> Math.nope(1)\n')).not.toThrow();
  });
});
