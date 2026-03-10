import { expectReply } from './helpers.js';

describe('silent handler (end, no reply)', () => {
  it('inline form — no post fired', async () => {
    const source = 'on notify(:msg : Text) end\n';
    await expectReply({
      source,
      receive: { id: '123', op: [{ msg: 'attention' }, 'notify'], 'bv-a': [{ msg: 'Text' }, 'notify'], from: 'caller' },
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
      receive: { id: '1', op: [{ info: 'hello' }, 'log'], 'bv-a': [{ info: 'Text' }, 'log'], from: 'caller' },
    });
  });

  it('multi-handler — silent handler still suppresses post', async () => {
    const source = `
      on notify(:msg : Text) end
      on add(:a : Integer, :b : Integer) reply sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ msg: 'hi' }, 'notify'], 'bv-a': [{ msg: 'Text' }, 'notify'], from: 'caller' },
    });
  });

  it('multi-handler — replying handler still works alongside silent handler', async () => {
    const source = `
      on notify(:msg : Text) end
      on add(:a : Integer, :b : Integer) reply sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '2', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }, 'add'], from: 'caller' },
      reply: {
        id: '2', 'bv-a': [{ sum: 'Integer' }, 'add'], re: [{ sum: 7 }, 'add'], to: 'caller',
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
      receive: { id: '1', op: [{ msg: 'hello' }, 'notify'], 'bv-a': [{ msg: 'Text' }, 'notify'], from: 'caller' },
    });
  });

  it('type mismatch → ex unhandled  [companion: proves dispatch ran]', async () => {
    const source = 'on notify(:msg : Text) end\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ msg: 42 }, 'notify'], 'bv-a': [{ msg: 'Integer' }, 'notify'], from: 'caller' },
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
      receive: { id: '1', op: [{ msg: 42 }, 'notify'], 'bv-a': [{ msg: 'Integer' }, 'notify'], from: 'caller' },
    });
  });

  it('overloaded: silent Integer, replying Text — Text message: gets reply  [companion]', async () => {
    const source = `
      on notify(:msg : Integer) end
      on notify(:msg : Text) reply ack: "noted" : Text
    `;
    await expectReply({
      source,
      receive: { id: '2', op: [{ msg: 'hello' }, 'notify'], 'bv-a': [{ msg: 'Text' }, 'notify'], from: 'caller' },
      reply: { id: '2', 'bv-a': [{ ack: 'Text' }, 'notify'], re: [{ ack: 'noted' }, 'notify'], to: 'caller' },
    });
  });
});
