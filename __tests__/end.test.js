import { expectReply } from './helpers.js';

describe('silent handler (end, no reply)', () => {
  it('inline form — no post fired', async () => {
    const source = 'on notify(:msg : Text) end\n';
    await expectReply({
      source,
      receive: { id: '123', op: { notify: { msg: 'attention' } }, 'bv-a': { notify: { msg: 'Text' } }, from: 'caller' },
    });
  });

  it('open form — no post fired', async () => {
    const source = `
      on log
        :info : Text

        end
    `;
    await expectReply({
      source,
      receive: { id: '1', op: { log: { info: 'hello' } }, 'bv-a': { log: { info: 'Text' } }, from: 'caller' },
    });
  });

  it('multi-handler — silent handler still suppresses post', async () => {
    const source = `
      on notify(:msg : Text) end
      on add(:a : Integer, :b : Integer) reply sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: { notify: { msg: 'hi' } }, 'bv-a': { notify: { msg: 'Text' } }, from: 'caller' },
    });
  });

  it('multi-handler — replying handler still works alongside silent handler', async () => {
    const source = `
      on notify(:msg : Text) end
      on add(:a : Integer, :b : Integer) reply sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '2', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' },
      reply: {
        id: '2', 'bv-a': { add: { sum: 'Integer' } }, re: { add: { sum: 7 } }, to: 'caller',
      },
    });
  });

  it('unhandled op is still distinguished from silent handler', async () => {
    const source = 'on notify(:msg : Text) end\n';
    await expectReply({
      source,
      receive: { id: '9', op: 'unknown', from: 'caller' },
      reply: {
        id: '9', ex: { unknown: 'unhandled' }, to: 'caller',
      },
    });
  });
});

describe('silent handler + type matching', () => {
  it('type match → no post', async () => {
    const source = 'on notify(:msg : Text) end\n';
    await expectReply({
      source,
      receive: { id: '1', op: { notify: { msg: 'hello' } }, 'bv-a': { notify: { msg: 'Text' } }, from: 'caller' },
    });
  });

  it('type mismatch → ex unhandled  [companion: proves dispatch ran]', async () => {
    const source = 'on notify(:msg : Text) end\n';
    await expectReply({
      source,
      receive: { id: '1', op: { notify: { msg: 42 } }, 'bv-a': { notify: { msg: 'Integer' } }, from: 'caller' },
      reply: { id: '1', ex: { notify: 'unhandled' }, to: 'caller' },
    });
  });

  it('overloaded: silent Integer, replying Text — Integer message: no post', async () => {
    const source = `
      on notify(:msg : Integer) end
      on notify(:msg : Text) reply ack: "noted" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: { notify: { msg: 42 } }, 'bv-a': { notify: { msg: 'Integer' } }, from: 'caller' },
    });
  });

  it('overloaded: silent Integer, replying Text — Text message: gets reply  [companion]', async () => {
    const source = `
      on notify(:msg : Integer) end
      on notify(:msg : Text) reply ack: "noted" : Text
    `;
    await expectReply({
      source,
      receive: { id: '2', op: { notify: { msg: 'hello' } }, 'bv-a': { notify: { msg: 'Text' } }, from: 'caller' },
      reply: { id: '2', 'bv-a': { notify: { ack: 'Text' } }, re: { notify: { ack: 'noted' } }, to: 'caller' },
    });
  });
});
