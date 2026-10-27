import { compileSource, compileActor } from '../helpers.js';
import { domManifest } from '../../src/codegen/browser/runtime.js';

// `HTML::Event` — a Type defined (exported) by the HTML actor: the standard
// readable Event properties as value fields, plus the void methods
// (preventDefault / stopPropagation / stopImmediatePropagation) as silent
// endpoint reference fields. A handler receives it as a typed param, reads its
// value fields locally, and invokes the endpoints (fire-and-forget to the
// address each holds). This ties the reference-field mechanism to a real
// cross-module, actor-owned type.
//
// Event carries optional fields, so it travels as a name-keyed map.

const HTML = [{ path: 'HTML', service: domManifest }];

const handler = (body) => `
  *( "HTML": (HTML) )
  =
  @handle = (e: HTML::Event) ${body}
`;

// A representative Event value as it arrives on the wire (named map).
const evt = {
  prevent: '#<HTML @prevent1>',
  stop: '#<HTML @stop1>',
  stop_immediate: '#<HTML @stopi1>',
  kind: 'click',
};

describe('HTML::Event — cross-module type with endpoint fields', () => {
  it('resolves HTML::Event as a handler param type', () => {
    expect(() => compileSource(handler('{ e.prevent! . }'), { remotes: HTML })).not.toThrow();
  });

  it('rejects HTML::NoSuch', () => {
    expect(() => compileSource(`
      *( "HTML": (HTML) )
      =
      @handle = (e: HTML::NoSuch) -> ok: 1
    `, { remotes: HTML })).toThrow(/not exported by 'HTML'/);
  });

  it('invoking e.prevent! fires to the endpoint address the Event carries', async () => {
    const actor = await (await compileActor(handler('{ e.prevent! . }'), { compileOptions: { remotes: HTML } })).spawn();
    await actor.sendAsync({ id: '1', op: [{ e: evt }, '@handle'], 'bv-a': [{ e: '#<HTML ::Event>' }], from: 'c' });
    expect(actor.posts.some(p => p.op === '@prevent1' && p.to === '#<HTML @prevent1>')).toBe(true);
  });

  it('invoking e.stop! fires to the stop endpoint, not prevent', async () => {
    const actor = await (await compileActor(handler('{ e.stop! . }'), { compileOptions: { remotes: HTML } })).spawn();
    await actor.sendAsync({ id: '1', op: [{ e: evt }, '@handle'], 'bv-a': [{ e: '#<HTML ::Event>' }], from: 'c' });
    expect(actor.posts.some(p => p.op === '@stop1' && p.to === '#<HTML @stop1>')).toBe(true);
    expect(actor.posts.some(p => p.op === '@prevent1')).toBe(false);
  });

  it('invoking e.stop_immediate! fires to the stopImmediatePropagation endpoint', async () => {
    const actor = await (await compileActor(handler('{ e.stop_immediate! . }'), { compileOptions: { remotes: HTML } })).spawn();
    await actor.sendAsync({ id: '1', op: [{ e: evt }, '@handle'], 'bv-a': [{ e: '#<HTML ::Event>' }], from: 'c' });
    expect(actor.posts.some(p => p.op === '@stopi1' && p.to === '#<HTML @stopi1>')).toBe(true);
  });

  it('reads a value field locally (no send) and replies with it', async () => {
    const actor = await (await compileActor(
      handler('-> kind: (e.kind ?? "none")'),
      { compileOptions: { remotes: HTML } },
    )).spawn();
    await actor.sendAsync({ id: '1', op: [{ e: evt }, '@handle'], 'bv-a': [{ e: '#<HTML ::Event>' }], from: 'c' });
    const post = actor.posts.find(p => p.id === '1' && 're' in p);
    expect(post).toEqual(expect.objectContaining({ id: '1', re: { kind: 'click' }, to: 'c' }));
  });
});
