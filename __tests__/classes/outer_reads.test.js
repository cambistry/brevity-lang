import { compileActor, compileSource, expectBehavior } from '../helpers.js';

// A class closes over the file actor it's declared in. It's its own actor, so each read
// of a file's cell is a message to that actor, and sees the cell as it is then.
// See notes/session-2026-11-03-class-reads-file-cells.md.

const script = `
  total *Integer = 4
  @title *Text = "box"
  k = 5

  @W = *{
    seed *Integer = total
    @get = { return total }
    @title = { return @title }
    @k = { return k }
    @sum = { return total + k }
    @seed = { return seed }
    @named = { return :total }
    @param = (total Integer) { return total }
    @check = {
      if total > 10 { return "big" }
      return "small"
    }
  }

  Sub = (@W |) *{}

  @bump! = { total <- total + 10 }

  @inProcess = {
    w = @W()
    x Integer = w.get()
    return x
  }

  @fromSubclass = {
    s = Sub()
    x Integer = s.get()
    return x
  }
`;

const reply = (id, value) => expect.objectContaining({ id, re: [value], to: 'c' });

describe('a class reads its file\'s cells', () => {
  it('reads a cell', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@W', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<@W/1>' }) },
      { input: { id: '2', op: '@get', to: '@W/1', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [4], 'ty': ['Integer'] }) },
    );
  });

  it('sees a write the file makes after the class was constructed', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@W', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<@W/1>' }) },
      { input: { id: '2', op: '@bump!', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: '#<>' }) },
      { input: { id: '3', op: '@get', to: '@W/1', from: 'c' } },
      { output: reply('3', 14) },
      { input: { id: '4', op: '@check', to: '@W/1', from: 'c' } },
      { output: reply('4', 'big') },
    );
  });

  it('reads in its constructor block, once', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@W', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<@W/1>' }) },
      { input: { id: '2', op: '@bump!', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: '#<>' }) },
      { input: { id: '3', op: '@seed', to: '@W/1', from: 'c' } },
      { output: reply('3', 4) },
    );
  });

  it('reads a published cell, a constant, and both in one expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@W', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<@W/1>' }) },
      { input: { id: '2', op: '@title', to: '@W/1', from: 'c' } },
      { output: reply('2', 'box') },
      { input: { id: '3', op: '@k', to: '@W/1', from: 'c' } },
      { output: reply('3', 5) },
      { input: { id: '4', op: '@sum', to: '@W/1', from: 'c' } },
      { output: reply('4', 9) },
      { input: { id: '5', op: '@check', to: '@W/1', from: 'c' } },
      { output: reply('5', 'small') },
    );
  });

  it('names the cell in a reply', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@W', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<@W/1>' }) },
      { input: { id: '2', op: '@named', to: '@W/1', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: { total: 4 } }) },
    );
  });

  it('a param of the same name means the param', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@W', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<@W/1>' }) },
      { input: { id: '2', op: [[7], '@param'], 'ty': [['Integer']], to: '@W/1', from: 'c' } },
      { output: reply('2', 7) },
    );
  });

  it('reads while the file actor waits on it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@inProcess', from: 'c' } },
      { output: reply('1', 4) },
    );
  });

  it('a subclass reads through what it inherits', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@fromSubclass', from: 'c' } },
      { output: reply('1', 4) },
    );
  });
});

// A class can run while its file actor has nothing to wait on: a launched call, or a
// subscription callback. Its file actor still answers its reads and makes its calls.
// What the class sends and what the file actor replies can come in either order.
describe('a class reaches its file actor while the file actor is idle', () => {
  const script = `
    *
      "svc.bv": Svc {
        note. (Integer) => .
        Log (Integer) -> *{}
      }
    *
    total *Integer = 4
    @n *Integer = 0

    W = *{
      @read. = { log = Svc.Log(total) }
      @call. = { Svc.note.(total)... }
    }

    Reader = (:P *Integer) *{
      P.subscribe (v Integer) { log = Svc.Log(v + total) }
    }

    Caller = (:P *Integer) *{
      P.subscribe (v Integer) { Svc.note.(v + total)... }
    }

    @read = {
      w = W()
      w.read.()...
      return 1
    }

    @call! = {
      w = W()
      w.call.()...
      return 1
    }

    @watchRead = {
      r = Reader(P: @n)
      return 1
    }

    @watchCall = {
      c = Caller(P: @n)
      return 1
    }

    @bump! = { @n <- @n + 1 }
  `;

  const made = (actor) => actor.posts.filter(p => Array.isArray(p.op) && p.op[1] === '#new');
  const notes = (actor) => actor.posts.filter(p => Array.isArray(p.op) && p.op[1] === '@note.');
  const replies = (actor) => actor.posts.filter(p => p.to === 'c');

  it('a launched call reads a file cell', async () => {
    const actor = await (await compileActor(script)).spawn();
    await actor.sendAsync({ id: '1', op: '@read', from: 'c' });
    const [log] = made(actor);
    expect(log).toEqual(expect.objectContaining({ op: [[4], '#new'], to: 'Svc @Log' }));
    await actor.sendAsync({ id: log.id, re: '#<Svc @Log/1>', 'ty': 'Svc @Log', from: 'Svc' });
    expect(replies(actor)).toEqual([{ id: '1', re: [1], 'ty': ['Integer'], to: 'c' }]);
  });

  it('a launched call calls a file dependency', async () => {
    const actor = await (await compileActor(script)).spawn();
    await actor.sendAsync({ id: '1', op: '@call!', from: 'c' });
    expect(notes(actor)).toEqual([expect.objectContaining({ op: [[4], '@note.'], to: 'Svc' })]);
    expect(replies(actor)).toEqual([{ id: '1', re: [1], 'ty': ['Integer'], to: 'c' }]);
  });

  it('a subscription callback reads a file cell', async () => {
    const actor = await (await compileActor(script)).spawn();
    await actor.sendAsync({ id: '1', op: '@watchRead', from: 'c' });
    const [first] = made(actor);
    expect(first).toEqual(expect.objectContaining({ op: [[4], '#new'], to: 'Svc @Log' }));
    await actor.sendAsync({ id: first.id, re: '#<Svc @Log/1>', 'ty': 'Svc @Log', from: 'Svc' });
    await actor.sendAsync({ id: '2', op: '@bump!', from: 'c' });
    const [, second] = made(actor);
    expect(second).toEqual(expect.objectContaining({ op: [[5], '#new'], to: 'Svc @Log' }));
    await actor.sendAsync({ id: second.id, re: '#<Svc @Log/2>', 'ty': 'Svc @Log', from: 'Svc' });
    expect(replies(actor)).toEqual([
      { id: '1', re: [1], 'ty': ['Integer'], to: 'c' },
      expect.objectContaining({ id: '2', re: '#<>', to: 'c' }),
    ]);
  });

  it('a subscription callback calls a file dependency', async () => {
    const actor = await (await compileActor(script)).spawn();
    await actor.sendAsync({ id: '1', op: '@watchCall', from: 'c' });
    await actor.sendAsync({ id: '2', op: '@bump!', from: 'c' });
    expect(notes(actor)).toEqual([
      expect.objectContaining({ op: [[4], '@note.'], to: 'Svc' }),
      expect.objectContaining({ op: [[5], '@note.'], to: 'Svc' }),
    ]);
  });
});

describe('a class can\'t write its file\'s cells', () => {
  it('is a compile error', () => {
    expect(() => compileSource(`
      total *Integer = 4
      W = *{ @reset! = { total <- 2 } }
    `)).toThrow(/Cannot set 'total'/);
  });
});

describe('a class can\'t call its file\'s functions yet', () => {
  it('a private function is a compile error', () => {
    expect(() => compileSource(`
      f = () { return 6 }
      W = *{ @get = { x Integer = f(); return x } }
    `)).toThrow(/'f' is a function of this file, and a class can't call it yet/);
  });

  it('a public function is a compile error', () => {
    expect(() => compileSource(`
      @f = { return 6 }
      W = *{ @get = { x Integer = @f(); return x } }
    `)).toThrow(/'@f' is a function of this file, and a class can't call it yet/);
  });

  it('a class\'s own function of the same name is fine', () => {
    expect(() => compileSource(`
      @f = { return 6 }
      W = *{
        @f = { return 7 }
        @get = { x Integer = @f(); return x }
      }
    `)).not.toThrow();
  });
});
