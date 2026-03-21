import { runActor } from './helpers.js';

describe('test.op — public function', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref x : Integer = 0

        @inc
          =
          x <- x + 1
          -> :x

        @get
          =
          -> :x
      `,
      receive: [
        { id: '1', test: { op: '@inc' }, from: 't' },
        { id: '2', test: { op: '@inc' }, from: 't' },
        { id: '3', test: { op: '@get' }, from: 't' },
      ],
    });
  });

  it('dispatches public function', () => {
    expect(outputs[2]).toEqual(expect.objectContaining({ id: '3', re: { x: 2 } }));
  });
});

describe('test.op — private function', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        double
          =
          n : Integer
          =
          -> n * 2 : Integer

        @call
          =
          :n : Integer
          =
          result : Integer = double(n)
          -> :result
      `,
      receive: [
        { id: '1', test: { op: [[5], 'double'] }, from: 't' },
      ],
    });
  });

  it('dispatches private function directly', () => {
    expect(outputs[0]).toEqual(expect.objectContaining({ id: '1', re: [10] }));
  });
});

describe('test.op — with args', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref x : Integer = 0

        @add
          =
          :n : Integer
          =
          x <- x + n
          -> :x
      `,
      receive: [
        { id: '1', test: { op: [{ n: 3 }, '@add'] }, from: 't' },
        { id: '2', test: { op: [{ n: 7 }, '@add'] }, from: 't' },
        { id: '3', test: { get: 'x' }, from: 't' },
      ],
    });
  });

  it('passes args to op', () => {
    expect(outputs[2]).toEqual({ id: '3', re: 10, to: 't' });
  });
});

describe('test.op — bypasses schema validation', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        @echo
          =
          :msg : Text
          =
          -> :msg
      `,
      receive: [
        { id: '1', test: { op: [{ msg: 'hello' }, '@echo'] }, from: 't' },
      ],
    });
  });

  it('no bv-a required', () => {
    expect(outputs[0]).toEqual(expect.objectContaining({ id: '1', re: { msg: 'hello' } }));
  });
});
