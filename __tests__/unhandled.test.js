import { expectReply } from './helpers.js';

describe('unhandled op', () => {
  it('string op with no matching handler returns ex', async () => {
    const source = 'on hello() reply answer: "world" : Text\n';
    await expectReply({
      source,
      receive: { id: '12345', op: 'goodbye', from: 'caller' },
      reply: {
        id: '12345', ex: { goodbye: 'unhandled' }, to: 'caller',
      },
    });
  });

  it('object op with no matching handler returns ex', async () => {
    const source = 'on hello() reply answer: "world" : Text\n';
    await expectReply({
      source,
      receive: { id: '1', op: { compute: { x: 5 } }, 'bv-a': { compute: { x: 'Integer' } }, from: 'caller' },
      reply: {
        id: '1', ex: { compute: 'unhandled' }, to: 'caller',
      },
    });
  });

  it('multi-handler actor — unrecognised op returns ex', async () => {
    const source = `
      on hello() reply answer: "world" : Text
      on inc(:x : Integer) reply bigger: x + 1 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '99', op: 'nope', from: 'caller' },
      reply: {
        id: '99', ex: { nope: 'unhandled' }, to: 'caller',
      },
    });
  });

  it('multi-handler actor — recognised op still replies normally', async () => {
    const source = `
      on hello() reply answer: "world" : Text
      on inc(:x : Integer) reply bigger: x + 1 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: { inc: { x: 5 } }, 'bv-a': { inc: { x: 'Integer' } }, from: 'caller' },
      reply: {
        id: '1', 'bv-a': { inc: { bigger: 'Integer' } }, re: { inc: { bigger: 6 } }, to: 'caller',
      },
    });
  });
});
