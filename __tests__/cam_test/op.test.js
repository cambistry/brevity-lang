import { expectBehavior } from '../helpers.js';

describe('test.op — public function', () => {
  const script = `
    ref x Integer = 0

    @inc
      =
      x <- x + 1
      -> :x

    @get = -> :x
  `;

  it('dispatches public function', async () => {
    await expectBehavior({
      script,
      receive: [
        { id: '1', test: { op: '@inc' }, from: 't' },
        { id: '2', test: { op: '@inc' }, from: 't' },
        { id: '3', test: { op: '@get' }, from: 't' },
      ],
      reply: [
        expect.objectContaining({ id: '1', re: { x: 1 } }),
        expect.objectContaining({ id: '2', re: { x: 2 } }),
        expect.objectContaining({ id: '3', re: { x: 2 } }),
      ],
    });
  });
});

describe('test.op — private function', () => {
  const script = `
    double
      =
      n Integer
      =
      -> n * 2 as Integer

    @call
      =
      n: Integer
      =
      result Integer = double(n)
      -> :result
  `;

  it('dispatches private function directly', async () => {
    await expectBehavior({
      script,
      receive: { id: '1', test: { op: [[5], 'double'] }, from: 't' },
      reply: expect.objectContaining({ id: '1', re: [10] }),
    });
  });
});

describe('test.op — with args', () => {
  const script = `
    ref x Integer = 0

    @add
      =
      n: Integer
      =
      x <- x + n
      -> :x
  `;

  it('passes args to op', async () => {
    await expectBehavior({
      script,
      receive: [
        { id: '1', test: { op: [{ n: 3 }, '@add'] }, from: 't' },
        { id: '2', test: { op: [{ n: 7 }, '@add'] }, from: 't' },
        { id: '3', test: { get: 'x' }, from: 't' },
      ],
      reply: [
        expect.objectContaining({ id: '1', re: { x: 3 } }),
        expect.objectContaining({ id: '2', re: { x: 10 } }),
        { id: '3', 'bv-a': 'Integer', re: 10, to: 't' },
      ],
    });
  });
});

describe('test.op — bypasses schema validation', () => {
  const script = `
    @echo = |msg: Text| -> :msg
  `;

  it('no bv-a required', async () => {
    await expectBehavior({
      script,
      receive: { id: '1', test: { op: [{ msg: 'hello' }, '@echo'] }, from: 't' },
      reply: expect.objectContaining({ id: '1', re: { msg: 'hello' } }),
    });
  });
});
