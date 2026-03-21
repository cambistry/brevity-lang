import { runActor } from './helpers.js';

describe('test.update — dispatch to accumulator', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref x : Integer = 0

        @add
          =
          :delta : Integer
          =
          x <- x + delta
          -> :x

        @get
          =
          -> :x
      `,
      receive: [
        { id: '1', test: { op: [{ delta: 5 }, '@add'] }, from: 't' },
        { id: '2', test: { get: 'x' }, from: 't' },
      ],
    });
  });

  it('dispatches accumulation op', () => {
    expect(outputs[0]).toEqual(expect.objectContaining({ id: '1', re: { x: 5 } }));
  });

  it('state reflects the update', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': 'Integer', re: 5, to: 't' });
  });
});

describe('test.update — accumulation', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref x : Integer = 0

        @add
          =
          :delta : Integer
          =
          x <- x + delta
          -> :x

        @get
          =
          -> :x
      `,
      receive: [
        { id: '1', test: { op: [{ delta: 3 }, '@add'] }, from: 't' },
        { id: '2', test: { op: [{ delta: 7 }, '@add'] }, from: 't' },
        { id: '3', test: { get: 'x' }, from: 't' },
      ],
    });
  });

  it('updates accumulate', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': 'Integer', re: 10, to: 't' });
  });
});
