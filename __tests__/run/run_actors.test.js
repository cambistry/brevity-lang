import { runActors } from '../helpers.js';

// Several separately compiled actors, live, wired by name: what one posts to another's
// name is delivered to it, `from` the sender, and anything else is external. The same
// on every target.

const svc = '@double = (n Integer) -> n * 2\n';
const main = 'use Svc = "svc" as { double (Integer) -> (Integer) }\n@go = { x Integer = Svc.double(21); return x + 1 }\n';
const front = 'use Main = "main" as { go () -> (Integer) }\n@ask = { x Integer = Main.go(); return x * 10 }\n';

describe('runActors', () => {
  it('a call to another actor of the network, and its reply', async () => {
    const net = await runActors({ svc: { source: svc }, main: { source: main } });
    await net.send('main', { id: '1', op: 'go', from: 'c' });
    expect(net.external).toEqual([{ id: '1', re: [43], ty: ['Integer'], to: 'c' }]);
  });

  it('three actors, a call through the middle one', async () => {
    const net = await runActors({ svc: { source: svc }, main: { source: main }, front: { source: front } });
    await net.send('front', { id: '1', op: 'ask', from: 'c' });
    expect(net.external).toEqual([{ id: '1', re: [430], ty: ['Integer'], to: 'c' }]);
  });

  it('what goes to no actor of the network is external', async () => {
    const net = await runActors({ main: { source: main } });
    await net.send('main', { id: '1', op: 'go', from: 'c' });
    expect(net.external).toEqual([expect.objectContaining({ op: [[21], 'double'], to: 'svc' })]);
  });
});
