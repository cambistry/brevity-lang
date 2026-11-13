import { compileSource, expectBehavior, compileActor, expectActorBehavior } from '../helpers.js';

// An actor writes its own published cell as `@a <- v`, as it reads it. A bare `a` names
// a different, private cell.

const reply = (id, value) => expect.objectContaining({ id, re: [value], to: 'c' });

describe('@a <- v', () => {
  it('writes at file level', async () => {
    await expectBehavior(`
      @a *Integer = 3
      @bump! = { @a <- @a + 1 }
    `,
      { input: { id: '1', op: '@bump!', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<.>' }) },
      { input: { id: '2', op: '@a', from: 'c' } },
      { output: reply('2', 4) },
    );
  });

  it('writes in a class, and each actor has its own', async () => {
    await expectBehavior(`
      C = *{
        @a *Integer = 3
        @bump! = { @a <- @a + 1 }
      }

      @go = {
        x = C()
        y = C()
        x.bump!()
        p Integer = x.a()
        q Integer = y.a()
        return p * 10 + q
      }
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: reply('1', 43) },
    );
  });

  it('writes a cell inherited from a parent', async () => {
    await expectBehavior(`
      Base = *{
        @a *Integer = 3
      }
      Sub = (Base++) *{
        @bump! = { @a <- @a + 1 }
      }

      @go = {
        s = Sub()
        s.bump!()
        v Integer = s.a()
        return v
      }
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: reply('1', 4) },
    );
  });

  it('writes a cell with no setter', async () => {
    await expectBehavior(`
      @items *List of Integers = []
      @add! = (n Integer) { @items <- @items.append(n) }
    `,
      { input: { id: '1', op: [[5], '@add!'], 'ty': [['Integer']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<.>' }) },
      { input: { id: '2', op: '@items', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [[5]] }) },
    );
  });

  it('writes from a branch', async () => {
    await expectBehavior(`
      @a *Integer = 3
      @set_if! = (b Boolean) {
        if b { @a <- 9 }
      }
    `,
      { input: { id: '1', op: [[true], '@set_if!'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<.>' }) },
      { input: { id: '2', op: '@a', from: 'c' } },
      { output: reply('2', 9) },
    );
  });

  it('updates with <|', async () => {
    await expectBehavior(`
      @a *Integer = 3
      @replace! = { @a <| 7 }
    `,
      { input: { id: '1', op: '@replace!', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<.>' }) },
      { input: { id: '2', op: '@a', from: 'c' } },
      { output: reply('2', 7) },
    );
  });

  it('stays separate from a private cell of the same name', async () => {
    await expectBehavior(`
      a *Integer = 1
      @a *Integer = 2
      @write! = {
        a <- 10
        @a <- 20
      }
      @both = { return a + @a }
    `,
      { input: { id: '1', op: '@both', from: 'c' } },
      { output: reply('1', 3) },
      { input: { id: '2', op: '@write!', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: '#<.>' }) },
      { input: { id: '3', op: '@both', from: 'c' } },
      { output: reply('3', 30) },
    );
  });
});

describe('subscribers', () => {
  it('see the write', async () => {
    const actor = await (await compileActor(`
      @a *Integer = 3
      @bump! = { @a <- @a + 1 }
    `)).spawn();
    await expectActorBehavior(actor,
      { input: { id: 's', op: '@subscribe', to: '. a', from: 'sub' } },
      { output: expect.objectContaining({ id: 's', re: [3], to: 'sub' }) },
      { input: { id: '1', op: '@bump!', from: 'c' } },
      { output: expect.objectContaining({ id: 's', re: [4], to: 'sub' }) },
      { output: expect.objectContaining({ id: '1', re: '#<.>' }) },
    );
  });

  it('see a function derived from the cell change too', async () => {
    const actor = await (await compileActor(`
      @a *Integer = 3
      @twice = { @a * 2 }
      @bump! = { @a <- @a + 1 }
    `)).spawn();
    await expectActorBehavior(actor,
      { input: { id: 's', op: '@subscribe', to: '. twice', from: 'sub' } },
      { output: expect.objectContaining({ id: 's', re: [6], to: 'sub' }) },
      { input: { id: '1', op: '@bump!', from: 'c' } },
      { output: expect.objectContaining({ id: 's', re: [8], to: 'sub' }) },
      { output: expect.objectContaining({ id: '1', re: '#<.>' }) },
    );
  });

  it('in the same file see a class actor\'s write', async () => {
    await expectBehavior(`
      C = *{
        @a *Integer = 3
        @bump! = { @a <- @a + 1 }
      }

      seen *Integer = 0
      c = C()

      @watch. = { c.a.subscribe (v) { seen <- v } }
      @go! = {
        c.bump!()
        return seen
      }
    `,
      { input: { id: '1', op: '@watch.', from: 'c' } },
      { input: { id: '2', op: '@go!', from: 'c' } },
      { output: reply('2', 4) },
    );
  });
});

describe('checks', () => {
  it('a bare name is not the published cell', () => {
    expect(() => compileSource('@a *Integer = 3\n@bump! = { a <- a + 1 }\n')).toThrow(/'a' isn't in scope — the published cell is '@a'/);
    expect(() => compileSource('@a *Integer = 3\n@get = { return a }\n')).toThrow(/'a' isn't in scope — the published cell is '@a'/);
    expect(() => compileSource('C = *{\n  @a *Integer = 3\n  @bump! = { a <- 1 }\n}\n')).toThrow(/published cell is '@a'/);
  });

  it('a local or param of that name is fine', () => {
    expect(() => compileSource('@a *Integer = 3\n@f = (a Integer) { return a }\n')).not.toThrow();
    expect(() => compileSource('@a *Integer = 3\n@f = {\n  a Integer = 1\n  return a\n}\n')).not.toThrow();
    expect(() => compileSource('C = (a: Integer) *{\n  @a *Integer = a\n  @b = { return a }\n}\n')).not.toThrow();
  });

  it('only a published cell can be written', () => {
    expect(() => compileSource('@f = { return 1 }\n@go! = { @f <- 2 }\n')).toThrow(/'@f' — it isn't a published cell/);
    expect(() => compileSource('C = *{\n  @go! = { @a <- 2 }\n}\n@a *Integer = 1\n')).toThrow(/'@a' — it isn't a published cell of this class/);
  });

  it('a write needs !, unless the cell is untracked', () => {
    expect(() => compileSource('@a *Integer = 3\n@bump = { @a <- 1 }\n')).toThrow(/'@bump' writes/);
    expect(() => compileSource('untracked @log *Text = ""\n@note = (m Text) {\n  @log <- @log + m\n  return 1\n}\n')).not.toThrow();
  });
});
