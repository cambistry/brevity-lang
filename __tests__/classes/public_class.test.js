import { extract } from '../../index.js';
import { expectBehavior, compileSource } from '../helpers.js';

// A public class is named `@Pub` in its own file, and is part of the file's doc.

describe('public class in its own file', () => {
  it('is constructed by its name', async () => {
    await expectBehavior(`
      @Pub = *{
        @one = { return 5 }
      }

      @go = {
        p = @Pub()
        n Integer = p.one()
        return n
      }
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: { id: '1', re: [5], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('takes constructor args', async () => {
    await expectBehavior(`
      @Pub = (n Integer) *{
        @get = { return n }
      }

      @go = {
        p = @Pub(7)
        v Integer = p.get()
        return v
      }
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: { id: '1', re: [7], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('can be a superclass', async () => {
    await expectBehavior(`
      @Base = *{
        @one = { return 1 }
      }

      @Sub = (@Base++) *{
        @two = { return 2 }
      }

      @go = {
        s = @Sub()
        a Integer = s.one()
        b Integer = s.two()
        return a + b
      }
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: { id: '1', re: [3], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('is checked like any class', () => {
    expect(() => compileSource('@Pub = *{\n  @one = { return 5 }\n}\n@go = {\n  p = @Pub()\n  n Integer = p.nope()\n  return n\n}\n')).toThrow(/has no method 'nope'/);
  });

  it('can\'t be declared twice', () => {
    expect(() => compileSource('@Pub = *{}\n@Pub = *{}\n@go = { return 1 }\n')).toThrow(/'@Pub' is declared more than once/);
  });

  it('can\'t share a name with a function', () => {
    expect(() => compileSource('@Pub = *{}\n@Pub = { return 1 }\n@go = { return 1 }\n')).toThrow(/'@Pub' is declared as both a class and a function/);
  });

  it('a bare name doesn\'t reach it', () => {
    expect(() => compileSource('@Pub = *{}\n@go = {\n  p = Pub()\n  return 1\n}\n')).toThrow(/'Pub' isn't in scope — the public class is '@Pub'/);
    expect(() => compileSource('@Pub = *{}\np = Pub()\n@go = { return 1 }\n')).toThrow(/'Pub' isn't in scope — the public class is '@Pub'/);
    expect(() => compileSource('@Pub! = *{}\n@go! = {\n  p = Pub!()\n  return 1\n}\n')).toThrow(/'Pub!' isn't in scope — the public class is '@Pub!'/);
  });

  it('a bare name doesn\'t reach it as a superclass or a type', () => {
    expect(() => compileSource('@Pub = *{}\n@Sub = (Pub++) *{}\n@go = { return 1 }\n')).toThrow(/'Pub' isn't in scope — the public class is '@Pub'/);
    expect(() => compileSource('@Pub = *{}\n@go = {\n  p Pub = @Pub()\n  return 1\n}\n')).toThrow(/'Pub' isn't in scope — the public class is '@Pub'/);
    expect(() => compileSource('@Pub = *{}\n@go = (p Pub) { return 1 }\n')).toThrow(/'Pub' isn't in scope — the public class is '@Pub'/);
  });

  it('a wrapped superclass has to be named', () => {
    expect(() => compileSource('@Pub = *{}\n@Sub = (@Pub* |) *{ @a = -> 1 }\n@go = { return 1 }\n')).toThrow(/write '\(name @Pub \+\+\)'/);
  });

  it('errors name it as it\'s written', () => {
    expect(() => compileSource('@Pub = *{}\n@go = {\n  p = @Pub()\n  n Integer = p.nope()\n  return n\n}\n')).toThrow(/'@Pub' has no method 'nope'/);
  });
});

describe('Box and @Box are different classes', () => {
  const script = `
    @Box = *{
      @who = { return "public" }
    }

    Box = *{
      @who = { return "private" }
    }

    @Arg = (n Integer) *{
      @get = { return n }
    }

    @PubSub = (@Box++) *{
      @own = { return "pubsub" }
    }

    PrivSub = (Box++) *{
      @own = { return "privsub" }
    }

    @Wrapper = (inner @Box ++) *{
      @viaInner = {
        t Text = inner.who()
        return t
      }
    }

    @Nearer = *{
      @Box = { return "own function" }
      @call = {
        t Text = @Box()
        return t
      }
    }

    held = @Box()

    @public = {
      b = @Box()
      t Text = b.who()
      return t
    }
    @private = {
      b = Box()
      t Text = b.who()
      return t
    }
    @inPlace = {
      t Text = @Box().who()
      return t
    }
    @annotated = {
      b @Box = @Box()
      t Text = b.who()
      return t
    }
    @withArg = {
      a = @Arg(7)
      n Integer = a.get()
      return n
    }
    @viaHeld = {
      t Text = held.who()
      return t
    }
    @pubSubWho = {
      s = @PubSub()
      t Text = s.who()
      return t
    }
    @privSubWho = {
      s = PrivSub()
      t Text = s.who()
      return t
    }
    @wrapped = {
      w = @Wrapper()
      t Text = w.viaInner()
      return t
    }
    @ownFunctionFirst = {
      n = @Nearer()
      t Text = n.call()
      return t
    }
  `;

  const reads = (op, value, type = 'Text') => expectBehavior(script,
    { input: { id: '1', op, from: 'c' } },
    { output: { id: '1', re: [value], 'ty': [type], to: 'c' } },
  );

  it('@Box() constructs the public class', () => reads('@public', 'public'));
  it('Box() constructs the private class', () => reads('@private', 'private'));
  it('@Box() can be used in place', () => reads('@inPlace', 'public'));
  it('@Box is a type', () => reads('@annotated', 'public'));
  it('@Box is a param\'s type', () => {
    expect(() => compileSource('@Box = *{\n  @who = { return "x" }\n}\n@go = (b @Box) {\n  t Text = b.nope()\n  return t\n}\n')).toThrow(/'@Box' has no method 'nope'/);
  });
  it('@Arg() takes args', () => reads('@withArg', 7, 'Integer'));
  it('a file-level @Box() is held in a cell', () => reads('@viaHeld', 'public'));
  it('@Box is a superclass', () => reads('@pubSubWho', 'public'));
  it('Box is a separate superclass', () => reads('@privSubWho', 'private'));
  it('@Box can be wrapped', () => reads('@wrapped', 'public'));
  it('a class\'s own @Box comes before the file\'s', () => reads('@ownFunctionFirst', 'own function'));

  it('the doc names only the public class, without its @', () => {
    const { interface: doc } = compileSource(script);
    expect(doc.service).toContain('Box () -> *{\n    who () -> (Text)\n  }');
    expect(doc.service).toContain('PubSub (Box++) -> *{');
    expect(doc.service).not.toContain('@Box');
    expect(doc.service).not.toContain('PrivSub');
  });
});

// A self-return from an actor made by `#new` replies as `#new` did: the actor's
// address in `re`, its class in `ty`. The file actor made it, so it adds the class.
describe('a self-return from an actor made by #new', () => {
  // A class named with `!` writes while constructing: here it tells `Svc`.
  const script = `
    *
      "svc.bv": Svc {
        note. () => .
      }
    *

    @Box = *{
      n *Integer = 0

      @bump! = { n <- n + 1 }
      @maybe! = (c Boolean) {
        if c { return self }
        n <- 10
        return self
      }
      @get = { return n }
    }

    @Pub! = *{
      n *Integer = 0
      Svc.note...

      @go! = { n <- 1 }
    }
  `;

  it('names the actor and its class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@Box', from: 'c' } },
      { output: { id: '1', re: '#<@Box/1>', 'ty': '@Box', to: 'c' } },
      { input: { id: '2', op: '@bump!', to: '@Box/1', from: 'c' } },
      { output: { id: '2', re: '#<@Box/1>', 'ty': '@Box', to: 'c', from: '@Box/1' } },
    );
  });

  it('from an early return', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@Box', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<@Box/1>' }) },
      { input: { id: '2', op: [[true], '@maybe!'], 'ty': [['Boolean']], to: '@Box/1', from: 'c' } },
      { output: { id: '2', re: '#<@Box/1>', 'ty': '@Box', to: 'c', from: '@Box/1' } },
      { input: { id: '3', op: [[false], '@maybe!'], 'ty': [['Boolean']], to: '@Box/1', from: 'c' } },
      { output: { id: '3', re: '#<@Box/1>', 'ty': '@Box', to: 'c', from: '@Box/1' } },
      { input: { id: '4', op: '@get', to: '@Box/1', from: 'c' } },
      { output: expect.objectContaining({ id: '4', re: [10] }) },
    );
  });

  it('a class named with ! keeps it in its class address', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@Pub!', from: 'c' } },
      { output: expect.objectContaining({ op: '@note.', to: 'Svc' }) },
      { output: { id: '1', re: '#<@Pub!/1>', 'ty': '@Pub!', to: 'c' } },
      { input: { id: '2', op: '@go!', to: '@Pub!/1', from: 'c' } },
      { output: { id: '2', re: '#<@Pub!/1>', 'ty': '@Pub!', to: 'c', from: '@Pub!/1' } },
    );
  });
});

// `self` as one slot of several: `#<>` in `re`, a bare `@` in `ty`. The parent that
// made the actor fills in both, as for a whole-value self-return.
describe('self as one of several return values', () => {
  const script = `
    @Box = *{
      n *Integer = 0

      @pair! = {
        n <- n + 1
        return (self, n)
      }
      @named! = {
        n <- n + 1
        return (me: self, n: n)
      }
    }

    Box = *{
      @pair = { return (self, 5) }
      @get = { return 7 }
    }

    @local = {
      b = Box()
      (a, k) = b.pair()
      v Integer = a.get()
      return (v, k)
    }
  `;

  it('positional: the parent names the actor and its class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@Box', from: 'c' } },
      { output: { id: '1', re: '#<@Box/1>', 'ty': '@Box', to: 'c' } },
      { input: { id: '2', op: '@pair!', to: '@Box/1', from: 'c' } },
      { output: { id: '2', re: ['#<@Box/1>', 1], 'ty': ['@Box', 'Integer'], to: 'c', from: '@Box/1' } },
    );
  });

  it('named: the parent names the actor and its class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@Box', from: 'c' } },
      { output: { id: '1', re: '#<@Box/1>', 'ty': '@Box', to: 'c' } },
      { input: { id: '2', op: '@named!', to: '@Box/1', from: 'c' } },
      { output: { id: '2', re: { me: '#<@Box/1>', n: 1 }, 'ty': { me: '@Box', n: 'Integer' }, to: 'c', from: '@Box/1' } },
    );
  });

  it('in process: the caller gets the actor it called', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@local', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [7, 5], to: 'c' }) },
    );
  });
});

describe('#new beside @Box()', () => {
  const script = `
    @Box = *{
      secret = { return "secret" }
      #hidden = { return "hidden" }

      @who = { return "public" }
      @viaSecret = {
        t Text = secret()
        return t
      }
      @viaHidden = {
        t Text = #hidden()
        return t
      }
    }

    Box = *{
      @who = { return "private" }
    }

    @local = {
      b = @Box()
      t Text = b.who()
      return t
    }
  `;

  it('#new reaches the public class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@Box', from: 'c' } },
      { output: { id: '1', re: '#<@Box/1>', 'ty': '@Box', to: 'c' } },
      { input: { id: '2', op: '@who', to: '@Box/1', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: ['public'], to: 'c', from: '@Box/1' }) },
    );
  });

  it('an actor made by #new calls its own private functions', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@Box', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<@Box/1>' }) },
      { input: { id: '2', op: '@viaSecret', to: '@Box/1', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: ['secret'] }) },
      { input: { id: '3', op: '@viaHidden', to: '@Box/1', from: 'c' } },
      { output: expect.objectContaining({ id: '3', re: ['hidden'] }) },
    );
  });

  it('outside, an actor\'s private functions don\'t answer', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@Box', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<@Box/1>' }) },
      { input: { id: '2', op: 'secret', to: '@Box/1', from: 'c' } },
      { output: expect.objectContaining({ id: '2', ex: { secret: 'unhandled' } }) },
      { input: { id: '3', op: '#hidden', to: '@Box/1', from: 'c' } },
      { output: expect.objectContaining({ id: '3', ex: { '#hidden': 'unhandled' } }) },
    );
  });

  it('@Box() gives its actor no registered address', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@local', from: 'c' } },
      { output: { id: '1', re: ['public'], 'ty': ['Text'], to: 'c' } },
      { input: { id: '2', op: '@who', to: '@Box/1', from: 'c' } },
      { output: expect.objectContaining({ id: '2', ex: expect.anything() }) },
    );
  });
});

describe('passing an actor to a function', () => {
  const script = `
    @Box = *{
      n *Integer = 0

      @who = { return "public" }
      @get = { return n }
      @bump! = { n <- n + 1 }
    }

    Box = *{
      @who = { return "private" }
    }

    @takes = (b @Box) {
      t Text = b.who()
      return t
    }
    takesPrivately = (b @Box) {
      t Text = b.who()
      return t
    }
    takesTheOther = (b Box) {
      t Text = b.who()
      return t
    }
    bumps! = (b @Box) {
      b.bump!()
    }

    returnsItsCall = (b @Box) { return b.who() }
    untyped = (b) { return b.who() }

    @returnsTyped = { return returnsItsCall(@Box()) }
    @returnsUntyped = { return untyped(@Box()) }
    @returnsUntypedBound = {
      b = @Box()
      return untyped(b)
    }

    @toPublic = {
      r Text = @takes(@Box())
      return r
    }
    @toPrivate = {
      r Text = takesPrivately(@Box())
      return r
    }
    @toPrivateClass = {
      r Text = takesTheOther(Box())
      return r
    }
    @bound = {
      b = @Box()
      r Text = @takes(b)
      return r
    }
    takesNamed = (b: @Box) {
      t Text = b.who()
      return t
    }
    @named = {
      b = @Box()
      r Text = takesNamed(b: b)
      s Text = b.who()
      return r + s
    }
    @sameActor! = {
      b = @Box()
      bumps!(b)
      n Integer = b.get()
      return n
    }
  `;

  it('the doc names the param\'s type without its @', () => {
    expect(extract(script).interface.service).toContain('takes (Box) -> (Text)');
  });

  const reads = (op, value, type = 'Text') => expectBehavior(script,
    { input: { id: '1', op, from: 'c' } },
    { output: { id: '1', re: [value], 'ty': [type], to: 'c' } },
  );

  it('a public function can call it', () => reads('@toPublic', 'public'));
  it('a private function can call it', () => reads('@toPrivate', 'public'));
  it('a private class\'s actor passes too', () => reads('@toPrivateClass', 'private'));
  it('one held in a local passes too', () => reads('@bound', 'public'));
  it('a named arg passes it, and the caller keeps it', () => reads('@named', 'publicpublic'));
  it('the function reaches the same actor', () => reads('@sameActor!', 1, 'Integer'));
  // Nothing annotates these returns, so there's no type to tag the reply with.
  it('a function can return its call on it', () => expectBehavior(script,
    { input: { id: '1', op: '@returnsTyped', from: 'c' } },
    { output: expect.objectContaining({ id: '1', re: ['public'], to: 'c' }) },
  ));
  it('an untyped param takes it', () => expectBehavior(script,
    { input: { id: '1', op: '@returnsUntyped', from: 'c' } },
    { output: expect.objectContaining({ id: '1', re: ['public'], to: 'c' }) },
  ));
  it('an untyped param takes one held in a local', () => expectBehavior(script,
    { input: { id: '1', op: '@returnsUntypedBound', from: 'c' } },
    { output: expect.objectContaining({ id: '1', re: ['public'], to: 'c' }) },
  ));
});

describe('W and @W! are different classes', () => {
  const script = `
    *
      "svc.bv": Svc {
        note. () => .
      }
    *

    @W! = *{
      Svc.note...
      @who = { return "public" }
    }

    W = *{
      @who = { return "private" }
    }

    @public! = {
      w @W = @W!()
      t Text = w.who()
      return t
    }
    @private = {
      w = W()
      t Text = w.who()
      return t
    }
  `;

  it('@W!() constructs the public class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@public!', from: 'c' } },
      { output: expect.objectContaining({ op: '@note.', to: 'Svc' }) },
      { output: { id: '1', re: ['public'], 'ty': ['Text'], to: 'c' } },
    );
  });

  it('W() constructs the private class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@private', from: 'c' } },
      { output: { id: '1', re: ['private'], 'ty': ['Text'], to: 'c' } },
    );
  });
});
