import { expectReply } from './helpers.js';

describe('unhandled op', () => {
  it('string op with no matching public function returns ex', async () => {
    const source = '@hello = -> answer: "world" : Text\n';
    await expectReply({
      source,
      receive: { id: '12345', op: 'goodbye', from: 'caller' },
      reply: {
        id: '12345', ex: { goodbye: 'unhandled' }, to: 'caller',
      },
    });
  });

  it('object op with no matching public function returns ex', async () => {
    const source = '@hello = -> answer: "world" : Text\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ x: 5 }, 'compute'], 'bv-a': [{ x: 'Integer' }], from: 'caller' },
      reply: {
        id: '1', ex: { compute: 'unhandled' }, to: 'caller',
      },
    });
  });

  it('multi-public-function actor — unrecognised op returns ex', async () => {
    const source = `
      @hello = -> answer: "world" : Text
      @inc = |:x : Integer| -> bigger: x + 1 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '99', op: 'nope', from: 'caller' },
      reply: {
        id: '99', ex: { nope: 'unhandled' }, to: 'caller',
      },
    });
  });

  it('multi-public-function actor — recognised op still replies normally', async () => {
    const source = `
      @hello = -> answer: "world" : Text
      @inc = |:x : Integer| -> bigger: x + 1 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ x: 5 }, 'inc'], 'bv-a': [{ x: 'Integer' }], from: 'caller' },
      reply: {
        id: '1', 'bv-a': { bigger: 'Integer' }, re: { bigger: 6 }, to: 'caller',
      },
    });
  });
});
