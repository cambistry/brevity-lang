import { compileSource, compileActor } from '../helpers.js';

// Cross-module type carrying reference fields — the pure language feature,
// with no dependence on any real service.
//
// A fictional service `Widget` exports a Type `::Control` whose fields are a
// mix of silent endpoint references (`() -> .` — fire-and-forget) and an
// ordinary value field. A handler receives it as a typed param `Widget::Control`,
// reads the value field locally, and invokes the endpoints (fire to the address
// each field holds). This exercises cross-module type resolution + the
// reference-field mechanism together, abstractly. Live integration of a
// concrete service's event type (e.g. the browser's HTML::Event, with its full
// field set) belongs in a .browser.test.js, not here.
//
// `::Control` carries an optional field, so it travels as a name-keyed map.

const WIDGET = `{
  ::Control = (
    press: () -> .
    release: () -> .
    reset: () -> .
    ? label: Text
  )
}`;

const remotes = [{ path: 'Widget', service: WIDGET }];

const handler = (body) => `
  *( "Widget": (Widget) )
  =
  @handle = (c: Widget::Control) ${body}
`;

// A representative Control value as it arrives on the wire (named map): each
// endpoint field holds the address to fire, the value field holds its datum.
const ctl = {
  press: '#<Widget @press1>',
  release: '#<Widget @release1>',
  reset: '#<Widget @reset1>',
  label: 'ready',
};

describe('cross-module type with reference fields', () => {
  it('resolves a cross-module type as a handler param', () => {
    expect(() => compileSource(handler('{ c.press() . }'), { remotes })).not.toThrow();
  });

  it('rejects a name the service does not export', () => {
    expect(() => compileSource(`
      *( "Widget": (Widget) )
      =
      @handle = (c: Widget::NoSuch) -> ok: 1
    `, { remotes })).toThrow(/not exported by 'Widget'/);
  });

  it('invoking c.press() fires to the endpoint address the value carries', async () => {
    const actor = await (await compileActor(handler('{ c.press() . }'), { compileOptions: { remotes } })).spawn();
    await actor.sendAsync({ id: '1', op: [{ c: ctl }, '@handle'], 'bv-a': [{ c: '#<Widget ::Control>' }], from: 'c' });
    expect(actor.posts.some(p => p.op === '@press1' && p.to === '#<Widget @press1>')).toBe(true);
  });

  it('invoking c.release() fires to the release endpoint, not press', async () => {
    const actor = await (await compileActor(handler('{ c.release() . }'), { compileOptions: { remotes } })).spawn();
    await actor.sendAsync({ id: '1', op: [{ c: ctl }, '@handle'], 'bv-a': [{ c: '#<Widget ::Control>' }], from: 'c' });
    expect(actor.posts.some(p => p.op === '@release1' && p.to === '#<Widget @release1>')).toBe(true);
    expect(actor.posts.some(p => p.op === '@press1')).toBe(false);
  });

  it('invoking c.reset() fires to the reset endpoint', async () => {
    const actor = await (await compileActor(handler('{ c.reset() . }'), { compileOptions: { remotes } })).spawn();
    await actor.sendAsync({ id: '1', op: [{ c: ctl }, '@handle'], 'bv-a': [{ c: '#<Widget ::Control>' }], from: 'c' });
    expect(actor.posts.some(p => p.op === '@reset1' && p.to === '#<Widget @reset1>')).toBe(true);
  });

  it('reads a value field locally (no send) and replies with it', async () => {
    const actor = await (await compileActor(
      handler('-> label: (c.label ?? "none")'),
      { compileOptions: { remotes } },
    )).spawn();
    await actor.sendAsync({ id: '1', op: [{ c: ctl }, '@handle'], 'bv-a': [{ c: '#<Widget ::Control>' }], from: 'c' });
    const post = actor.posts.find(p => p.id === '1' && 're' in p);
    expect(post).toEqual(expect.objectContaining({ id: '1', re: { label: 'ready' }, to: 'c' }));
  });
});
