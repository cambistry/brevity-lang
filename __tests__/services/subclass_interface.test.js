import { extract } from '../../index.js';
import { parseInterface } from '../../src/parser_interface.js';
import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// A subclass in the service document
//
// A class's node lists its parents under `extends`, in order, each an address. Its
// `$new` takes its own params when it has a constructor of its own, and its parents'
// when it hasn't. Its instances' interface (`instance`) is the composite: its own ops, then
// what it inherits that it doesn't define (notes/opre-type-encoding-2026-11-21.md).
// ═══════════════════════════════════════════════════════════════════════════════

const svc = (source) => extract(source).interface.service;
const $new = (args, cls) => [{ ...(args && { args }), re: [`:${cls}`], writes: false }];
const v = [{ re: [{ v: 'Integer' }], writes: false }];

describe('subclass interface — $new', () => {
  it('a subclass with no constructor of its own takes its parent\'s params', () => {
    const s = svc(`
      @T = (x: Integer) *{ @a = -> v: x as Integer }
      @U = @T ^ *{}
    `);
    expect(s[':U'].extends).toEqual([':T']);
    expect(s[':U'].public.$new).toEqual($new([{ x: 'Integer' }], 'U'));
  });

  it('a constructor of its own takes its own named params only', () => {
    const s = svc(`
      @T = (x: Integer) *{ @a = -> v: x as Integer }
      @U = @T ^ (y: Integer) *{ super(x: y) }
    `);
    expect(s[':U'].public.$new).toEqual($new([{ y: 'Integer' }], 'U'));
  });

  it('a constructor of its own takes its own positional params only', () => {
    const s = svc(`
      @T = (x Integer) *{ @a = -> v: x as Integer }
      @U = @T ^ (y Integer) *{ super(y) }
    `);
    expect(s[':U'].public.$new).toEqual($new(['Integer'], 'U'));
  });

  it('two parents, in order', () => {
    const s = svc(`
      @A = (a: Integer) *{ @ga = -> v: a as Integer }
      @B = (b: Integer) *{ @gb = -> v: b as Integer }
      @C = @A ^ @B ^ (c: Integer) *{ super[@A](a: c); super[@B](b: c) }
    `);
    expect(s[':C'].extends).toEqual([':A', ':B']);
    expect(s[':C'].public.$new).toEqual($new([{ c: 'Integer' }], 'C'));
  });

  it('a constructor of its own with no params takes none', () => {
    const s = svc(`
      @T = (x: Integer) *{ @a = -> v: x as Integer }
      @U = @T ^ *{ super(x: 1) }
    `);
    expect(s[':U'].public.$new).toEqual($new(null, 'U'));
  });

  it('reads back which subclasses have a constructor of their own', () => {
    const parsed = parseInterface('{\n  T (x: Integer) -> *{}\n  U T ^ () -> *{}\n  V T ^ (y: Integer) -> *{}\n  W T ^ -> *{}\n}');
    expect(parsed.__types.U.ownNew).toBe(true);
    expect(parsed.__types.V.ownNew).toBe(true);
    expect(parsed.__types.W.ownNew).toBeUndefined();
  });

});

describe('subclass interface — its instances', () => {
  it('an empty subclass\'s instances have its parent\'s ops', () => {
    const s = svc(`
      @T = (x: Integer) *{ @a = -> v: x as Integer }
      @U = @T ^ *{}
    `);
    expect(s[':U'].instance).toEqual({ public: { a: v } });
  });

  it('its own ops, then what it inherits', () => {
    const s = svc(`
      @T = (x: Integer) *{ @a = -> v: x as Integer }
      @U = @T ^ (y: Integer) *{ super(x: y); @b = -> v: y as Integer }
    `);
    expect(Object.keys(s[':U'].instance.public)).toEqual(['b', 'a']);
  });

  it('two parents\' ops, in order', () => {
    const s = svc(`
      @A = (a: Integer) *{ @ga = -> v: a as Integer }
      @B = (b: Integer) *{ @gb = -> v: b as Integer }
      @C = @A ^ @B ^ (c: Integer) *{ super[@A](a: c); super[@B](b: c) }
    `);
    expect(s[':C'].instance).toEqual({ public: { ga: v, gb: v } });
  });
});

describe('subclass interface — chain depth', () => {
  it('extends names the direct parent; its instances have every ancestor\'s ops', () => {
    const s = svc(`
      @A = (a: Integer) *{ @ga = -> v: a as Integer }
      @B = @A ^ (b: Integer) *{ super(a: b); @gb = -> v: b as Integer }
      @C = @B ^ (c: Integer) *{ super(b: c); @gc = -> v: c as Integer }
    `);
    expect(s[':C'].extends).toEqual([':B']);
    expect(s[':C'].instance).toEqual({ public: { gc: v, gb: v, ga: v } });
  });
});

describe('subclass interface — the parent', () => {
  it('a parent has no extends, and only its own ops', () => {
    const s = svc(`
      @T = (x: Integer) *{ @a = -> v: x as Integer }
      @U = @T ^ (y: Integer) *{ super(x: y) }
    `);
    expect(s[':T']).toEqual({ public: { $new: $new([{ x: 'Integer' }], 'T') }, instance: { public: { a: v } } });
  });
});

describe('subclass interface — private parent', () => {
  // A private parent has no node of its own, so a public class states what it
  // inherits from one in place.
  const doc = svc(`
    @G = *{ @g = { return 1 } }
    T = (x: Integer) *{
      @a = { return 'text' }
      @k = { return 1 }
    }
    P = @G ^ (@p: Integer) *{ super(); @m = { return 2 } }
    @U = T ^ (y: Integer) *{
      super(x: y)
      @a = { return 2 }
      @b = { return 3 }
    }
    @V = P ^ (z: Integer) *{ super(p: z) }

    @go = { return 4 }
  `);
  const int = [{ re: ['Integer'], writes: false }];

  it('states inherited members in place, with no extends, and only its own params', () => {
    expect(doc[':U']).toEqual({
      public: { $new: $new([{ y: 'Integer' }], 'U') },
      instance: { public: { k: int, a: int, b: int } },
    });
  });

  it('keeps a public ancestor behind the private parent', () => {
    expect(doc[':V']).toEqual({
      extends: [':G'],
      public: { $new: $new([{ z: 'Integer' }], 'V') },
      instance: { public: { p: int, m: int, g: int } },
    });
  });

  it('the file lists its own ops only, and no private class', () => {
    expect(doc.public).toEqual({ go: int });
    expect(Object.keys(doc).filter(k => k.startsWith(':'))).toEqual([':G', ':U', ':V']);
  });
});

describe('subclass interface — ^ forms', () => {
  it('a bare pure subclass', () => {
    const s = svc(`
      @T = *{ @a = -> v: 1 as Integer }
      @U = @T^
    `);
    expect(s[':U']).toEqual({ extends: [':T'], public: { $new: $new(null, 'U') }, instance: { public: { a: v } } });
  });

  it('two parents with no params', () => {
    const s = svc(`
      @A = *{ @ga = -> v: 1 as Integer }
      @B = *{ @gb = -> v: 2 as Integer }
      @C = @A ^ @B
    `);
    expect(s[':C'].extends).toEqual([':A', ':B']);
  });

  it('a name and type after the last ^ is a param, not a wrapped parent', () => {
    const s = svc(`
      Box = *{ @g = -> v: 1 as Integer }
      @A = *{ @ga = -> v: 1 as Integer }
      @U = @A ^ (b Box) *{ super() }
    `);
    expect(s[':U'].extends).toEqual([':A']);
    expect(s[':U'].public.$new).toEqual($new([':~Box'], 'U'));
  });

  it('a param typed with a public class is a param, not a wrapped parent', () => {
    const s = svc(`
      @Box = *{ @g = -> v: 1 as Integer }
      @A = *{ @ga = -> v: 1 as Integer }
      @U = @A ^ (b @Box) *{ super() }
    `);
    expect(s[':U'].extends).toEqual([':A']);
    expect(s[':U'].public.$new).toEqual($new([':Box'], 'U'));
  });

  it('reads parents and params back', () => {
    const parsed = parseInterface('{\n  A () -> *{}\n  B () -> *{}\n  C A ^ B ^ (c: Integer) -> *{}\n  D A ^ B ^ -> *{}\n  E A ^ -> *{}\n}');
    expect(parsed.__types.C.supertypes).toEqual([{ supertype: 'A' }, { supertype: 'B' }]);
    expect(parsed.__types.C.initParams.map(p => p.name)).toEqual(['c']);
    expect(parsed.__types.D.supertypes).toEqual([{ supertype: 'A' }, { supertype: 'B' }]);
    expect(parsed.__types.D.initParams).toEqual([]);
    expect(parsed.__types.E.supertypes).toEqual([{ supertype: 'A' }]);
  });

  it('a union param is not a supertype', () => {
    const parsed = parseInterface('{\n  C (Integer | Text) -> *{}\n}');
    expect(parsed.__types.C.supertypes).toEqual([]);
    expect(parsed.__types.C.initParams).toHaveLength(1);
  });

  it('a param type ending in a bare `|` is an error', () => {
    expect(() => parseInterface('{\n  Text (Node |) -> *{}\n}')).toThrow("In '(Node |)': Unexpected token in a type: PIPE ''");
  });
});

describe('class params typed with a public class', () => {
  const script = `
    @Box = (n Integer) *{
      @get = { return n }
    }
    @U = (b @Box) *{
      @get = { return b.get() }
    }
    @V = (b: @Box) *{
      @get = { return b.get() }
    }

    @positional = {
      u = @U(@Box(3))
      r Integer = u.get()
      return r
    }
    @named = {
      v = @V(b: @Box(4))
      r Integer = v.get()
      return r
    }
  `;

  it('a positional one is one param', () => {
    expect(svc(script)[':U'].public.$new).toEqual($new([':Box'], 'U'));
  });

  it('a named one is one param', () => {
    expect(svc(script)[':V'].public.$new).toEqual($new([{ b: ':Box' }], 'V'));
  });

  it('the actor reaches a positional one', () => expectBehavior(script,
    { input: { id: '1', op: 'positional', from: 'c' } },
    { output: { id: '1', re: [3], 'ty': ['Integer'], to: 'c' } },
  ));

  it('the actor reaches a named one', () => expectBehavior(script,
    { input: { id: '1', op: 'named', from: 'c' } },
    { output: { id: '1', re: [4], 'ty': ['Integer'], to: 'c' } },
  ));
});

describe('params need a separator', () => {
  it('two class params with no separator are a parse error', () => {
    expect(() => extract('@U = (a Integer b Integer) *{}')).toThrow(/Expected ',' or a newline between params, got IDENT 'b'/);
  });

  it('a published class param after no separator is a parse error', () => {
    expect(() => extract('@U = (a Integer @b Integer) *{}')).toThrow(/Expected ',' or a newline between params, got AT/);
  });

  it('two function params with no separator are a parse error', () => {
    expect(() => extract('@f = (a Integer b Integer) { return a }')).toThrow(/Expected ',' between params, got IDENT 'b'/);
  });

  it('a newline separates class params', () => {
    expect(svc('@U = (\n  a Integer\n  b Integer\n) *{}')[':U'].public.$new).toEqual($new(['Integer', 'Integer'], 'U'));
  });
});

describe('a class handler replies with what its actor param answers', () => {
  const script = `
    Box = (n Integer) *{
      @get = { return n }
    }
    R = (b Box) *{
      @get = { return b.get() }
    }
    T = (b Box) *{
      @get = { b.get() }
    }

    @returned = {
      r = R(Box(5))
      v Integer = r.get()
      return v
    }
    @tail = {
      t = T(Box(6))
      v Integer = t.get()
      return v
    }
  `;

  it('by return', () => expectBehavior(script,
    { input: { id: '1', op: 'returned', from: 'c' } },
    { output: { id: '1', re: [5], 'ty': ['Integer'], to: 'c' } },
  ));

  it('as its tail', () => expectBehavior(script,
    { input: { id: '1', op: 'tail', from: 'c' } },
    { output: { id: '1', re: [6], 'ty': ['Integer'], to: 'c' } },
  ));
});
