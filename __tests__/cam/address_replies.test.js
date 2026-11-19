import { createActor, expectActorBehavior } from '../helpers.js';

// A reply is positional, and one that carries an address is no exception: the
// address is its one value, `re: ['#<…>']`, and its tag is `ty: [t]`.
//
//   $new                      re: ['#<:Box:1>']   ty: [':Box']   (its maker)
//   a self-return, the file   re: ['#<:>']        ty: ['*']      (no `new` built it)
//   a self-return, built      re: ['#<:Box:1>']   ty: [':Box']   (the parent fills in `:`)
//
// Receiving, a reply to `$new` names its actor in `re[0]`; a bare `re` isn't an
// address reply. See notes/actors-not-classes-2026-11-18.md.

describe('replies that carry an address', () => {
  const script = `
    @Box = (n Integer) *{
      count *Integer = n
      @bump! = { count <- count + 1 }
      @get = { return count }
    }

    total *Integer = 0
    @bump! = { total <- total + 1 }
  `;

  it('`$new` replies with the new actor\'s address, tagged with its maker', async () => {
    await expectActorBehavior(await createActor(script),
      { input: { id: '1', op: [[3], '$new'], ty: [['Integer']], to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
    );
  });

  it('the file\'s self-return is its local self address, tagged `*`', async () => {
    await expectActorBehavior(await createActor(script),
      { input: { id: '1', op: 'bump!', from: 'c' } },
      { output: { id: '1', re: ['#<:>'], ty: ['*'], to: 'c' } },
    );
  });

  it('a built actor\'s self-return is its address, tagged with its maker', async () => {
    await expectActorBehavior(await createActor(script),
      { input: { id: '1', op: [[3], '$new'], ty: [['Integer']], to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'bump!', to: ':Box:1', from: 'c' } },
      { output: { id: '2', re: ['#<:Box:1>'], ty: [':Box'], to: 'c', from: ':Box:1' } },
      { input: { id: '3', op: 'get', to: ':Box:1', from: 'c' } },
      { output: { id: '3', re: [4], ty: ['Integer'], to: 'c', from: ':Box:1' } },
    );
  });
});

describe('a dependency\'s reply to `$new`', () => {
  const script = `
    use Thing = "thing.bv" as (tag: Text) -> *{
      ping () -> (ok: Text)
    }

    @make = {
      t = Thing(tag: "x")
      :ok Text = t.ping()
      return :ok
    }
  `;

  it('names the new actor in its one value', async () => {
    await expectActorBehavior(await createActor(script),
      { input: { id: '1', op: 'make', from: 'c' } },
      { output: { id: '1', op: [[{ tag: 'x' }], '$new'], ty: [[{ tag: 'Text' }]], to: 'thing.bv' } },
      { input: { id: '1', re: ['#<thing.bv:9>'], ty: ['thing.bv'], from: 'thing.bv' } },
      { output: { id: '2', op: 'ping', to: 'thing.bv:9' } },
      { input: { id: '2', re: { ok: 'pong' }, ty: { ok: 'Text' }, from: 'thing.bv:9' } },
      { output: { id: '1', re: { ok: 'pong' }, ty: { ok: 'Text' }, to: 'c' } },
    );
  });

  it('a bare `re` isn\'t an address reply: the construction fails', async () => {
    await expectActorBehavior(await createActor(script),
      { input: { id: '1', op: 'make', from: 'c' } },
      { output: { id: '1', op: [[{ tag: 'x' }], '$new'], ty: [[{ tag: 'Text' }]], to: 'thing.bv' } },
      { input: { id: '1', re: '#<thing.bv:9>', ty: 'thing.bv', from: 'thing.bv' } },
      { output: { id: '1', ex: { make: 'error' }, to: 'c' } },
    );
  });
});
