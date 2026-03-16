import compile from '../index.js';
import { expectReply, runActor } from './helpers.js';

// ── Silent handler (on) ─────────────────────────────────────────────────────

describe('silent handler — dot terminator', () => {
  it('inline form — no post fired', async () => {
    const source = 'on notify(:msg : Text) .\n';
    await expectReply({
      source,
      receive: { id: '123', op: [{ msg: 'attention' }, 'notify'], 'bv-a': [{ msg: 'Text' }], from: 'caller' },
    });
  });

  it('dot on own line — no post fired', async () => {
    const source = `
      on log
        :info : Text

        .
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ info: 'hello' }, 'log'], 'bv-a': [{ info: 'Text' }], from: 'caller' },
    });
  });

  it('dot on same line as last statement', async () => {
    const posts = await runActor({
      source: `
        init
          $last : Text = ""

        on store(:msg : Text)
          $last = msg .

        on check()
          reply last: $last : Text
      `,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: [{ msg: 'hello' }, 'store'], 'bv-a': [{ msg: 'Text' }], from: 'caller' },
        { id: '2', op: 'check', from: 'caller' },
      ],
    });
    expect(posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '2', re: { last: 'hello' } }),
    ]));
  });

  it('multi-handler — silent handler suppresses post', async () => {
    const source = `
      on notify(:msg : Text) .
      on add(:a : Integer, :b : Integer) reply sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ msg: 'hi' }, 'notify'], 'bv-a': [{ msg: 'Text' }], from: 'caller' },
    });
  });

  it('multi-handler — replying handler still works alongside silent handler', async () => {
    const source = `
      on notify(:msg : Text) .
      on add(:a : Integer, :b : Integer) reply sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '2', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: {
        id: '2', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'caller',
      },
    });
  });

  it('unhandled op is still distinguished from silent handler', async () => {
    const source = 'on notify(:msg : Text) .\n';
    await expectReply({
      source,
      receive: { id: '9', op: 'unknown', from: 'caller' },
      reply: {
        id: '9', ex: { unknown: 'unhandled' }, to: 'caller',
      },
    });
  });
});

// ── Silent handler + type matching ──────────────────────────────────────────

describe('silent handler + type matching', () => {
  it('type match → no post', async () => {
    const source = 'on notify(:msg : Text) .\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ msg: 'hello' }, 'notify'], 'bv-a': [{ msg: 'Text' }], from: 'caller' },
    });
  });

  it('type mismatch → ex unhandled', async () => {
    const source = 'on notify(:msg : Text) .\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ msg: 42 }, 'notify'], 'bv-a': [{ msg: 'Integer' }], from: 'caller' },
      reply: { id: '1', ex: { notify: 'unhandled' }, to: 'caller' },
    });
  });

  it('overloaded: silent Integer, replying Text — Integer message: no post', async () => {
    const source = `
      on notify(:msg : Integer) .
      on notify(:msg : Text) reply ack: "noted" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ msg: 42 }, 'notify'], 'bv-a': [{ msg: 'Integer' }], from: 'caller' },
    });
  });

  it('overloaded: silent Integer, replying Text — Text message: gets reply', async () => {
    const source = `
      on notify(:msg : Integer) .
      on notify(:msg : Text) reply ack: "noted" : Text
    `;
    await expectReply({
      source,
      receive: { id: '2', op: [{ msg: 'hello' }, 'notify'], 'bv-a': [{ msg: 'Text' }], from: 'caller' },
      reply: { id: '2', 'bv-a': { ack: 'Text' }, re: { ack: 'noted' }, to: 'caller' },
    });
  });
});

// ── Silent proc ─────────────────────────────────────────────────────────────

describe('silent proc — dot terminator', () => {
  it('compiler error when calling silent proc without spawn', () => {
    expect(() => compile(`
      on test()
        fire()
        reply answer: "done" : Text

      proc fire()
        .
    `)).toThrow(/Silent proc invocation requires 'spawn'/);
  });

  it('inline form — spawn + silent proc', async () => {
    const source = `
      on test()
        spawn fire()
        reply answer: "ok" : Text

      proc fire() .
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'caller' },
    });
  });

  it('dot on own line — spawn + silent proc', async () => {
    const source = `
      on test()
        spawn fire()
        reply answer: "ok" : Text

      proc fire()
        .
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'caller' },
    });
  });

  it('dot on same line as last statement — side-effect proc', async () => {
    const posts = await runActor({
      source: `
        init
          $x : Integer = 0

        on test()
          spawn fire()
          repeat while ($x == 0) __tick__()
          reply $x : Integer

        proc fire()
          $x = 1 .
      `,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: [1], to: 'caller' }),
    ]));
  });

  it('assigning result of silent proc is a compile error', () => {
    expect(() => compile(`
      on test()
        result : Integer = fire()
        reply result : Integer
      proc fire() .
    `)).toThrow(/Silent proc/);
  });
});
