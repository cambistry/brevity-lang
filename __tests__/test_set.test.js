import { runActor } from './helpers.js';

describe('test.set — dispatch to @<- handler', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref x : Integer = 0

        @put
          =
          :n : Integer
          =
          x <- n
          -> :x

        @get
          =
          -> :x
      `,
      receive: [
        { id: '1', test: { op: [{ n: 42 }, '@put'] }, from: 't' },
        { id: '2', test: { get: 'x' }, from: 't' },
      ],
    });
  });

  it('op dispatches set handler', () => {
    expect(outputs[0]).toEqual(expect.objectContaining({ id: '1', re: { x: 42 } }));
  });

  it('state reflects the set value', () => {
    expect(outputs[1]).toEqual({ id: '2', re: 42, to: 't' });
  });
});

describe('test.set — multiple sets', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref x : Integer = 0

        @put
          =
          :n : Integer
          =
          x <- n
          -> :x

        @get
          =
          -> :x
      `,
      receive: [
        { id: '1', test: { op: [{ n: 10 }, '@put'] }, from: 't' },
        { id: '2', test: { op: [{ n: 20 }, '@put'] }, from: 't' },
        { id: '3', test: { get: 'x' }, from: 't' },
      ],
    });
  });

  it('last set wins', () => {
    expect(outputs[2]).toEqual({ id: '3', re: 20, to: 't' });
  });
});
