import { runActor } from './helpers.js';

describe('underscore discard — positional destructure', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @discardFirst
        =
        ...args
        =
        _, b = args
        -> result: b : Integer

      @discardMiddle
        =
        ...args
        =
        a, _, b = args
        -> sum: a + b : Integer

      @discardAll
        =
        ...args
        =
        _, _ = args
        -> result: 0 : Integer

      @parenDiscard
        =
        ...args
        =
        (a, _, b) = args
        -> sum: a + b : Integer

      @twoConsecutive
        =
        ...args
        =
        a, _, _, d = args
        -> sum: a + d : Integer
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [[99, 42], 'discardFirst'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
        { id: '2', op: [[10, 99, 20], 'discardMiddle'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'c' },
        { id: '3', op: [[1, 2], 'discardAll'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
        { id: '4', op: [[5, 77, 6], 'parenDiscard'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'c' },
        { id: '5', op: [[1, 0, 0, 4], 'twoConsecutive'], 'bv-a': [['Integer', 'Integer', 'Integer', 'Integer']], from: 'c' },
      ],
    });
  });

  it('_, b = args — discard first, bind second', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' });
  });

  it('a, _, b = args — discard middle, bind first and third', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { sum: 'Integer' }, re: { sum: 30 }, to: 'c' });
  });

  it('_, _ = args — multiple discards, no bindings', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' });
  });

  it('(a, _, b) = args — paren form with discard', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { sum: 'Integer' }, re: { sum: 11 }, to: 'c' });
  });

  it('a, _, _, d = args — two consecutive discards', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { sum: 'Integer' }, re: { sum: 5 }, to: 'c' });
  });
});
