import { compileActor, compileSource, createActor, expectActorBehavior, expectBehavior } from '../helpers.js';

// A public class constructed from another file. `#new` with the class as selector;
// the reply's address names a sub-actor of whichever actor constructed it.

const SVC = `
  @Counter = (start Integer, step: Integer) *{
    n *Integer = start
    @get = { return n }
    @inc! = { n <- n + step }
  }

  @W! = *{
    @one = { return 1 }
  }

  @plain = { return 1 }
`;

const DOC = '{ Counter (Integer, step: Integer) -> *{\n  get () -> (Integer)\n  inc! () => self\n}\nW! () => *{\n  one () -> (Integer)\n}\nplain () -> (Integer) }';
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
        { input: { id: '1', re: '#<Svc @Counter/1>', 'bv-a': '#<Svc @Counter>', from: 'Svc' } },
        { output: expect.objectContaining({ op: '@get', to: 'Svc @Counter/1' }) },
      );
    });
  }

  it('an instance constructs through its own address', async () => {
    const actor = await createActor(`*\n  "svc.bv": Svc\n*\n@go = {\n  s = Svc()\n  w = s.W!()\n  return 1\n}\n`.replace('@go =', '@go! ='), { compileOptions: { remotes } });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: '@go!', from: 'c' } },
      { output: { id: '1', op: [{}, '#new'], to: 'Svc' } },
      { input: { id: '1', re: '#<Svc/7>', 'bv-a': '#<Svc>', from: 'Svc' } },
      { output: { id: '2', op: [{}, '#new'], to: 'Svc/7 @W!' } },
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

  it('must be bound before use', () => {
    expect(() => compile(`${header}@go = {\n  return Svc.Counter(1, step: 1).get()\n}\n`)).toThrow(/Bind the new 'Counter' first/);
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

describe('receiver side', () => {
  it('constructs, replies with an address, and routes to the new actor', async () => {
    await expectBehavior(SVC,
      { input: { id: '1', op: [[5, { step: 2 }], '#new'], to: '@Counter', from: 'c' } },
      { output: { id: '1', re: '#<@Counter/1>', 'bv-a': '#<@Counter>', to: 'c' } },
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
      { output: { id: '3', re: {}, 'bv-a': '#<@Counter/1>', to: 'c', from: '@Counter/1' } },
      { input: { id: '4', op: '@get', to: '@Counter/1', from: 'c' } },
      { output: expect.objectContaining({ id: '4', re: [7] }) },
      { input: { id: '5', op: '@get', to: '@Counter/2', from: 'c' } },
      { output: expect.objectContaining({ id: '5', re: [10] }) },
    );
  });

  it('keeps the ! in the selector', async () => {
    await expectBehavior(SVC,
      { input: { id: '1', op: [{}, '#new'], to: '@W!', from: 'c' } },
      { output: { id: '1', re: '#<@W!/1>', 'bv-a': '#<@W!>', to: 'c' } },
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
// the alias from `to`, and promotes the sender's local addresses as they leave.
describe('end to end', () => {
  const promote = (v, name) => {
    if (typeof v === 'string') return v.replace(/#<([@#:][^>]*)?>/g, (_, c) => (c ? `#<${name} ${c}>` : `#<${name}>`));
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
      await settle(svc, served);
      const reply = svc.posts[served++];
      await caller.sendAsync({ ...promote(reply, 'Svc'), to: undefined, from: reply.from ? `Svc ${reply.from}` : 'Svc' });
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
    expect(await run(`*\n  "svc.bv": Svc\n*\n@go = {\n  w = Svc.Counter(5, step: 2)\n  w.inc!()\n  v Integer = w.get()\n  return v\n}\n`, '@go')).toEqual([7]);
  }, 120000);

  it('constructs a class named with ! and calls it', async () => {
    expect(await run(`*\n  "svc.bv": Svc\n*\n@go! = {\n  w W = Svc.W!()\n  v Integer = w.one()\n  return v\n}\n`, '@go!')).toEqual([1]);
  }, 120000);
});
