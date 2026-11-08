import { compileActor, compileSource, createActor, expectActorBehavior, expectBehavior } from '../helpers.js';

// A public class constructed from another file. `#new` with the class as selector;
// the reply's address names a sub-actor of whichever actor constructed it.

// `@W!` writes while constructing, as a class named with `!` must: it tells `Log`.
const SVC = `
  *
    "log.bv": Log {
      note. () => .
    }
  *

  ::Point (x: Integer)

  @Counter = (start Integer, step: Integer) *{
    n *Integer = start
    @get = { return n }
    @inc! = { n <- n + step }
  }

  @W! = *{
    Log.note...
    @one = { return 1 }
  }

  @plain = { return 1 }

  @origin = { return Point(x: 1) }
`;

const DOC = '{ Counter (Integer, step: Integer) -> *{\n  get () -> (Integer)\n  inc! () => self\n}\nW! () => *{\n  one () -> (Integer)\n}\nplain () -> (Integer)\n::Point (x: Integer)\norigin () -> (Point) }';
const remotes = [{ path: 'svc.bv', service: DOC }];

describe('caller side', () => {
  const callers = {
    'Svc.Counter()': `*\n  "svc.bv": Svc\n*\n@go = {\n  w = Svc.Counter(5, step: 2)\n  v Integer = w.get()\n  return v\n}\n`,
    'a header binding': `*\n  "svc.bv": (:Counter)\n*\n@go = {\n  w = Counter(5, step: 2)\n  v Integer = w.get()\n  return v\n}\n`,
  };
  const target = { 'Svc.Counter()': 'Svc @Counter', 'a header binding': 'svc.bv @Counter' };

  for (const [label, source] of Object.entries(callers)) {
    it(`${label} sends #new, then calls the address in the reply`, async () => {
      const actor = await createActor(source, { compileOptions: { remotes } });
      await expectActorBehavior(actor,
        { input: { id: 'x', op: '@go', from: 'c' } },
        { output: { id: '1', op: [[5, { step: 2 }], '#new'], to: target[label] } },
        { input: { id: '1', re: '#<Svc @Counter/1>', 'ty': 'Svc @Counter', from: 'Svc' } },
        { output: expect.objectContaining({ op: '@get', to: 'Svc @Counter/1' }) },
      );
    });
  }

  it('an instance constructs through its own address', async () => {
    const actor = await createActor(`*\n  "svc.bv": Svc #\n*\n@go! = {\n  s = Svc()\n  w = s.W!()\n  return 1\n}\n`, { compileOptions: { remotes } });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: '@go!', from: 'c' } },
      { output: { id: '1', op: [[], '#new'], to: 'Svc' } },
      { input: { id: '1', re: '#<Svc/7>', 'ty': 'Svc', from: 'Svc' } },
      { output: { id: '2', op: [[], '#new'], to: 'Svc/7 @W!' } },
    );
  });
});

describe('checks', () => {
  const compile = (source) => compileSource(source, { remotes });
  const header = '*\n  "svc.bv": Svc\n*\n';

  it('checks members of the new actor', () => {
    expect(() => compile(`${header}w = Svc.Counter(1, step: 1)\n@go = {\n  w.nope()\n  return 1\n}\n`)).toThrow(/no method 'nope'/);
  });

  it('a class named with ! needs it at the call', () => {
    expect(() => compile(`${header}@go! = {\n  w = Svc.W()\n  return 1\n}\n`)).toThrow(/has no function 'W'.*W!/);
  });

  it('a class named with ! counts as a write for its caller', () => {
    expect(() => compile(`${header}@go = {\n  w = Svc.W!()\n  return 1\n}\n`)).toThrow(/'@go' writes/);
    expect(() => compile(`*\n  "svc.bv": (:W!)\n*\n@go = {\n  w = W!()\n  return 1\n}\n`)).toThrow(/'@go' writes/);
    expect(() => compile(`${header}@go! = {\n  w = Svc.W!()\n  return 1\n}\n`)).not.toThrow();
  });

  it('a class without ! is not a write', () => {
    expect(() => compile(`${header}@go = {\n  w = Svc.Counter(1, step: 1)\n  v Integer = w.get()\n  return v\n}\n`)).not.toThrow();
  });

  it('the annotation names the class, without !', () => {
    expect(() => compile(`${header}@go! = {\n  w W = Svc.W!()\n  return 1\n}\n`)).not.toThrow();
  });

  it('a header-bound class can be constructed in place', async () => {
    const actor = await createActor('*\n  "svc.bv": (:Counter)\n*\n@go = {\n  return Counter(1, step: 1)\n}\n', { compileOptions: { remotes } });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: '@go', from: 'c' } },
      { output: { id: '1', op: [[1, { step: 1 }], '#new'], to: 'svc.bv @Counter' } },
    );
  });

  it('a class takes its parent\'s params', () => {
    const service = '{ Base (a: Integer) -> *{}\nSub (Base | b: Integer) -> *{} }';
    const check = (args) => compileSource(`*\n  "svc.bv": (:Sub)\n*\n@go = {\n  s = Sub(${args})\n  return 1\n}\n`, { remotes: [{ path: 'svc.bv', service }] });
    expect(() => check('a: 1, b: 2')).not.toThrow();
    expect(() => check('b: 2')).toThrow(/doesn't match any constructor clause/);
  });

  it('a function in the doc is still a call', () => {
    expect(() => compile(`${header}@go = {\n  v Integer = Svc.plain()\n  return v\n}\n`)).not.toThrow();
  });
});

// A new actor needn't be bound first: `Svc` is an actor, and this is a message to it.
describe('a new actor used in place', () => {
  const script = `
    *
      "svc.bv": Svc
    *

    read = (w) { return w.get() }

    @chain = { return Svc.Counter(5, step: 2).get() }
    @give = { return Svc.Counter(5, step: 2) }
    @pass = { return read(Svc.Counter(5, step: 2)) }
  `;
  const compileOptions = { remotes };

  it('in a chain: #new, then a call to the address in the reply', async () => {
    const actor = await createActor(script, { compileOptions });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: '@chain', from: 'c' } },
      { output: { id: '1', op: [[5, { step: 2 }], '#new'], to: 'Svc @Counter' } },
      { input: { id: '1', re: '#<Svc @Counter/1>', 'ty': 'Svc @Counter', from: 'Svc' } },
      { output: expect.objectContaining({ id: '2', op: '@get', to: 'Svc @Counter/1' }) },
    );
  });

  it('in a return: #new, and the reply carries the address', async () => {
    const actor = await createActor(script, { compileOptions });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: '@give', from: 'c' } },
      { output: { id: '1', op: [[5, { step: 2 }], '#new'], to: 'Svc @Counter' } },
      { input: { id: '1', re: '#<Svc @Counter/1>', 'ty': 'Svc @Counter', from: 'Svc' } },
      { output: expect.objectContaining({ id: 'x', re: ['Svc @Counter/1'], to: 'c' }) },
    );
  });

  it('as an argument: the function calls the address it was given', async () => {
    const actor = await createActor(script, { compileOptions });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: '@pass', from: 'c' } },
      { output: { id: '1', op: [[5, { step: 2 }], '#new'], to: 'Svc @Counter' } },
      { input: { id: '1', re: '#<Svc @Counter/1>', 'ty': 'Svc @Counter', from: 'Svc' } },
      { output: expect.objectContaining({ op: '@get', to: 'Svc @Counter/1' }) },
    );
  });

  describe('through an instance', () => {
    const script = `
      *
        "svc.bv": Svc #
      *

      read = (w) { return w.get() }

      @chain = {
        s = Svc()
        return s.Counter(5, step: 2).get()
      }
      @give = {
        s = Svc()
        return s.Counter(5, step: 2)
      }
      @pass = {
        s = Svc()
        return read(s.Counter(5, step: 2))
      }
      @own = { return Svc().plain() }
    `;

    it('asks that instance, not the shared address', async () => {
      const actor = await createActor(script, { compileOptions });
      await expectActorBehavior(actor,
        { input: { id: 'x', op: '@chain', from: 'c' } },
        { output: { id: '1', op: [[], '#new'], to: 'Svc' } },
        { input: { id: '1', re: '#<Svc/7>', 'ty': 'Svc', from: 'Svc' } },
        { output: { id: '2', op: [[5, { step: 2 }], '#new'], to: 'Svc/7 @Counter' } },
        { input: { id: '2', re: '#<Svc/7 @Counter/1>', 'ty': 'Svc/7 @Counter', from: 'Svc/7' } },
        { output: expect.objectContaining({ id: '3', op: '@get', to: 'Svc/7 @Counter/1' }) },
      );
    });

    it('returned, it still asks that instance', async () => {
      const actor = await createActor(script, { compileOptions });
      await expectActorBehavior(actor,
        { input: { id: 'x', op: '@give', from: 'c' } },
        { output: { id: '1', op: [[], '#new'], to: 'Svc' } },
        { input: { id: '1', re: '#<Svc/7>', 'ty': 'Svc', from: 'Svc' } },
        { output: { id: '2', op: [[5, { step: 2 }], '#new'], to: 'Svc/7 @Counter' } },
      );
    });

    it('as an argument, it still asks that instance', async () => {
      const actor = await createActor(script, { compileOptions });
      await expectActorBehavior(actor,
        { input: { id: 'x', op: '@pass', from: 'c' } },
        { output: { id: '1', op: [[], '#new'], to: 'Svc' } },
        { input: { id: '1', re: '#<Svc/7>', 'ty': 'Svc', from: 'Svc' } },
        { output: { id: '2', op: [[5, { step: 2 }], '#new'], to: 'Svc/7 @Counter' } },
      );
    });

    it('a # entry can be constructed and called in place', async () => {
      const actor = await createActor(script, { compileOptions });
      await expectActorBehavior(actor,
        { input: { id: 'x', op: '@own', from: 'c' } },
        { output: { id: '1', op: [[], '#new'], to: 'Svc' } },
        { input: { id: '1', re: '#<Svc/7>', 'ty': 'Svc', from: 'Svc' } },
        { output: expect.objectContaining({ id: '2', op: '@plain', to: 'Svc/7' }) },
      );
    });
  });

  describe('from a header binding', () => {
    const script = `
      *
        "svc.bv": (:Counter)
      *

      @chain = { return Counter(5, step: 2).get() }
    `;

    it('in a chain', async () => {
      const actor = await createActor(script, { compileOptions });
      await expectActorBehavior(actor,
        { input: { id: 'x', op: '@chain', from: 'c' } },
        { output: { id: '1', op: [[5, { step: 2 }], '#new'], to: 'svc.bv @Counter' } },
        { input: { id: '1', re: '#<Svc @Counter/1>', 'ty': 'Svc @Counter', from: 'Svc' } },
        { output: expect.objectContaining({ id: '2', op: '@get', to: 'Svc @Counter/1' }) },
      );
    });
  });

  it('a param typed as a different class refuses it', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc
      *
      read = (w W) { return w.one() }
      @go = { return read(Svc.Counter(1, step: 1)) }
    `, { remotes })).toThrow(/not assignable to 'W'/);
  });

  it('checks members of the new actor', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc
      *
      @go = { return Svc.Counter(1, step: 1).nope() }
    `, { remotes })).toThrow(/no method 'nope'/);
  });

  it('a file-level construction can\'t be used in place', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc
      *
      n Integer = Svc.Counter(1, step: 1).get()
      @go = { return n }
    `, { remotes })).toThrow(/Bind the new 'Counter' first/);
  });

  it('a class named with ! still counts as a write for its caller', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc
      *
      @go = { return Svc.W!().one() }
    `, { remotes })).toThrow(/'@go' writes/);
  });
});

// A bare entry is an actor to talk to; `#` is something to construct one from.
describe('bare and # headers', () => {
  it('a bare entry is already an actor, so it can\'t be constructed', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc
      *
      @go = {
        s = Svc()
        return 1
      }
    `, { remotes })).toThrow(/'Svc' is already an actor.*"svc\.bv": Svc #/);
  });

  it('nor constructed in place', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc
      *
      @go = { return Svc() }
    `, { remotes })).toThrow(/'Svc' is already an actor/);
  });

  it('a # entry has to be constructed before it can be messaged', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc #
      *
      @go = { return Svc.plain() }
    `, { remotes })).toThrow(/'Svc' isn't an actor yet.*x = Svc\(/);
  });

  it('nor can it be asked for a class', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc #
      *
      @go = {
        w = Svc.Counter(1, step: 1)
        return 1
      }
    `, { remotes })).toThrow(/'Svc' isn't an actor yet/);
  });

  it('a declared constructor follows the # rule', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc () -> *{ get () -> (Integer) }
      *
      @go = { return Svc.get() }
    `)).toThrow(/'Svc' isn't an actor yet/);
  });

  it('a declared constructor can be constructed', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc () -> *{ get () -> (Integer) }
      *
      @go = {
        s = Svc()
        v Integer = s.get()
        return v
      }
    `)).not.toThrow();
  });

  it('an inline interface is an actor too', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc { get () -> (Integer) }
      *
      @go = {
        s = Svc()
        return 1
      }
    `)).toThrow(/'Svc' is already an actor/);
  });
});

// `::` names types. A class has no `::` form: `w W` is how to annotate one.
describe('qualified annotations', () => {
  it('a wrong qualified type is refused', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc
      *
      @go = {
        p Svc::Nope = Svc.origin()
        return 1
      }
    `, { remotes })).toThrow(/Nope/);
  });

  it('an alias that isn\'t in the header is refused', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc
      *
      @go = {
        p Other::Point = Svc.origin()
        return 1
      }
    `, { remotes })).toThrow(/Other/);
  });

  it('a class has no :: form', () => {
    expect(() => compileSource(`
      *
        "svc.bv": Svc
      *
      @go = {
        w Svc::Counter = Svc.Counter(1, step: 1)
        return 1
      }
    `, { remotes })).toThrow(/'Svc::Counter' names a class.*w Counter/);
  });
});

describe('receiver side', () => {
  it('constructs, replies with an address, and routes to the new actor', async () => {
    await expectBehavior(SVC,
      { input: { id: '1', op: [[5, { step: 2 }], '#new'], to: '@Counter', from: 'c' } },
      { output: { id: '1', re: '#<@Counter/1>', 'ty': '@Counter', to: 'c' } },
      { input: { id: '2', op: '@get', to: '@Counter/1', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [5], to: 'c', from: '@Counter/1' }) },
    );
  });

  it('each construction is its own actor', async () => {
    await expectBehavior(SVC,
      { input: { id: '1', op: [[5, { step: 2 }], '#new'], to: '@Counter', from: 'c' } },
      { output: expect.objectContaining({ re: '#<@Counter/1>' }) },
      { input: { id: '2', op: [[10, { step: 1 }], '#new'], to: '@Counter', from: 'c' } },
      { output: expect.objectContaining({ re: '#<@Counter/2>' }) },
      { input: { id: '3', op: '@inc!', to: '@Counter/1', from: 'c' } },
      { output: { id: '3', re: '#<@Counter/1>', 'ty': '@Counter', to: 'c', from: '@Counter/1' } },
      { input: { id: '4', op: '@get', to: '@Counter/1', from: 'c' } },
      { output: expect.objectContaining({ id: '4', re: [7] }) },
      { input: { id: '5', op: '@get', to: '@Counter/2', from: 'c' } },
      { output: expect.objectContaining({ id: '5', re: [10] }) },
    );
  });

  it('keeps the ! in the selector', async () => {
    await expectBehavior(SVC,
      { input: { id: '1', op: [{}, '#new'], to: '@W!', from: 'c' } },
      { output: expect.objectContaining({ op: '@note.', to: 'Log' }) },
      { output: { id: '1', re: '#<@W!/1>', 'ty': '@W!', to: 'c' } },
      { input: { id: '2', op: '@one', to: '@W!/1', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [1] }) },
    );
  });

  it('a private class can\'t be constructed from outside', async () => {
    await expectBehavior(`Hidden = *{\n  @one = { return 1 }\n}\n@go = { return 1 }\n`,
      { input: { id: '1', op: [{}, '#new'], to: '@Hidden', from: 'c' } },
      { output: expect.objectContaining({ id: '1', ex: expect.anything() }) },
    );
  });
});

// Two compiled files talking, on every target. The relay plays the parent: it strips
// the alias from `to`, and promotes the sender's local addresses and `ty` tags as they
// leave. Local starts with a delimiter; `ty` tags have no `#<…>`.
describe('end to end', () => {
  const promoteTy = (v, name) => {
    if (typeof v === 'string') return v === '' || /^\w/.test(v) ? v : `${name} ${v}`;
    if (Array.isArray(v)) return v.map(x => promoteTy(x, name));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, promoteTy(x, name)]));
    return v;
  };
  const promote = (v, name) => {
    if (typeof v === 'string') return v.replace(/#<([^\w>][^>]*)?>/g, (_, c) => (c ? `#<${name} ${c}>` : `#<${name}>`));
    if (Array.isArray(v)) return v.map(x => promote(x, name));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, promote(x, name)]));
    return v;
  };

  // A caller blocks on each call, so it's relayed one message at a time: its next post
  // is only meaningful once the previous one has been answered.
  async function relay(caller, svc, first) {
    const settle = async (actor, count) => {
      for (let i = 0; i < 200 && actor.posts.length <= count; i++) await new Promise(resolve => setTimeout(resolve, 5));
    };
    await caller.sendAsync(first);
    let answered = 0;
    let served = 0;
    for (let step = 0; step < 20; step++) {
      await settle(caller, answered);
      const msg = caller.posts[answered++];
      if (msg.to === 'c') return msg;
      const to = msg.to.startsWith('Svc') ? msg.to.slice(3).trim() : msg.to;
      await svc.sendAsync({ ...msg, to: to || undefined, from: 'Caller' });
      // The service's own calls, such as `@W!` telling `Log`, aren't replies.
      let reply;
      do {
        await settle(svc, served);
        reply = svc.posts[served++];
      } while (reply && 'op' in reply);
      const { ty, ...rest } = reply;
      await caller.sendAsync({ ...promote(rest, 'Svc'), ...('ty' in reply ? { ty: promoteTy(ty, 'Svc') } : {}), to: undefined, from: reply.from ? `Svc ${reply.from}` : 'Svc' });
    }
    throw new Error('the caller never replied');
  }

  const run = async (source, op) => {
    const svc = await (await compileActor(SVC)).spawn();
    const caller = await (await compileActor(source, { compileOptions: { remotes } })).spawn();
    const reply = await relay(caller, svc, { id: 'x', op, from: 'c' });
    return reply.re;
  };

  it('constructs a class from another file and calls it', async () => {
    expect(await run(`*\n  "svc.bv": Svc\n*\n@go! = {\n  w = Svc.Counter(5, step: 2)\n  w.inc!()\n  v Integer = w.get()\n  return v\n}\n`, '@go!')).toEqual([7]);
  }, 120000);

  it('constructs a class named with ! and calls it', async () => {
    expect(await run(`*\n  "svc.bv": Svc\n*\n@go! = {\n  w W = Svc.W!()\n  v Integer = w.one()\n  return v\n}\n`, '@go!')).toEqual([1]);
  }, 120000);

  describe('in place', () => {
    const script = `
      *
        "svc.bv": Svc
      *

      read = (w) { return w.get() }
      readTyped = (w Counter) { return w.get() }

      @chain = { return Svc.Counter(5, step: 2).get() }
      @passTyped = { return readTyped(Svc.Counter(5, step: 2)) }
      @writes! = { return Svc.Counter(5, step: 2).inc!().get() }
      @pass = { return read(Svc.Counter(5, step: 2)) }
      @nested = { return Svc.Counter(Svc.Counter(1, step: 1).get(), step: 2).get() }
      @assign = {
        v Integer = Svc.Counter(5, step: 2).get()
        return v
      }
      @point = {
        p Svc::Point = Svc.origin()
        return p.x
      }
      @lineal = -> Svc.Counter(5, step: 2).get()
      @branch = {
        if 1 > 0 { return Svc.Counter(5, step: 2).get() }
        return 0
      }
    `;

    it('a chain', async () => {
      expect(await run(script, '@chain')).toEqual([5]);
    }, 120000);

    it('a chain through a write', async () => {
      expect(await run(script, '@writes!')).toEqual([7]);
    }, 120000);

    it('an argument', async () => {
      expect(await run(script, '@pass')).toEqual([5]);
    }, 120000);

    it('an argument to a param typed as the class', async () => {
      expect(await run(script, '@passTyped')).toEqual([5]);
    }, 120000);

    it('as an arg to another construction', async () => {
      expect(await run(script, '@nested')).toEqual([1]);
    }, 120000);

    it('bound to a typed local', async () => {
      expect(await run(script, '@assign')).toEqual([5]);
    }, 120000);

    it('a lineal body', async () => {
      expect(await run(script, '@lineal')).toEqual([5]);
    }, 120000);

    it('a branch', async () => {
      expect(await run(script, '@branch')).toEqual([5]);
    }, 120000);

    it('a local annotated with a qualified type', async () => {
      expect(await run(script, '@point')).toEqual([1]);
    }, 120000);
  });

  describe('in place, from a header binding', () => {
    const script = `
      *
        "svc.bv": (:Counter)
      *

      @chain = { return Counter(5, step: 2).get() }
    `;

    it('a chain', async () => {
      expect(await run(script, '@chain')).toEqual([5]);
    }, 120000);
  });
});

// A class reads the cells of the actor that made it (see classes/outer_reads.test.js).
// `Svc.Reader()` asks the shared actor and `s.Reader()` asks `s`, so they read different
// `total`s. The relay holds the shared actor, and makes a fresh one for `#new` to `Svc`.
describe('end to end: Svc.W() and s.W() read different actors', () => {
  const READER_SVC = `
    total *Integer = 4

    @Reader = *{
      @get = { return total }
    }

    @bump! = { total <- total + 10 }
  `;
  const readerRemotes = [{ path: 'svc.bv', service: '{ Reader () -> *{\n  get () -> (Integer)\n}\nbump! () => self }' }];
  const shared = `*\n  "svc.bv": Svc\n*\n@read = { return Svc.Reader().get() }\n`;
  const own = `*\n  "svc.bv": Svc #\n*\n@read = {\n  s = Svc()\n  return s.Reader().get()\n}\n`;

  const promote = (v, name) => {
    if (typeof v === 'string') return v.replace(/#<([@#:][^>]*)?>/g, (_, c) => (c ? `#<${name} ${c}>` : `#<${name}>`));
    if (Array.isArray(v)) return v.map(x => promote(x, name));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, promote(x, name)]));
    return v;
  };
  const settle = async (actor, count) => {
    for (let i = 0; i < 200 && actor.posts.length <= count; i++) await new Promise(resolve => setTimeout(resolve, 5));
  };

  async function read(callerSource) {
    const svc = await (await compileActor(READER_SVC)).spawn();
    await svc.sendAsync({ id: 'b', op: '@bump!', from: 'other' });
    await settle(svc, 0);
    const actors = { Svc: { actor: svc, served: 1 } };
    const caller = await (await compileActor(callerSource, { compileOptions: { remotes: readerRemotes } })).spawn();
    await caller.sendAsync({ id: 'x', op: '@read', from: 'c' });
    let answered = 0;
    for (let step = 0; step < 20; step++) {
      await settle(caller, answered);
      const msg = caller.posts[answered++];
      if (msg.to === 'c') return msg.re;
      if (msg.to === 'Svc' && Array.isArray(msg.op) && msg.op[1] === '#new') {
        actors['Svc/7'] = { actor: await (await compileActor(READER_SVC)).spawn(), served: 0 };
        await caller.sendAsync({ id: msg.id, re: '#<Svc/7>', 'ty': 'Svc', from: 'Svc' });
        continue;
      }
      const name = msg.to.startsWith('Svc/7') ? 'Svc/7' : 'Svc';
      const target = actors[name];
      const to = msg.to.slice(name.length).trim();
      await target.actor.sendAsync({ ...msg, to: to || undefined, from: 'Caller' });
      await settle(target.actor, target.served);
      const reply = target.actor.posts[target.served++];
      await caller.sendAsync({ ...promote(reply, name), to: undefined, from: reply.from ? `${name} ${reply.from}` : name });
    }
    throw new Error('the caller never replied');
  }

  it('Svc.Reader() reads the shared actor', async () => {
    expect(await read(shared)).toEqual([14]);
  }, 120000);

  it('s.Reader() reads s', async () => {
    expect(await read(own)).toEqual([4]);
  }, 120000);
});
