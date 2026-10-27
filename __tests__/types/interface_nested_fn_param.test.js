import { parseInterface } from '../../src/codegen/javascript/types.js';

// A service method whose parameter is itself a callback (a nested function type)
// must parse with the *top-level* arrow as the signature's arrow — not the
// inner arrow of the callback. Previously `parseSigForm` used `indexOf('->')`,
// which matched the inner `->` and mangled the param list.
//
// Pure interface-parser unit test — no browser, no services beyond a fictional
// manifest string.

describe('interface parser — nested function-type parameter', () => {
  it('keeps a silent-callback parameter intact (top-level arrow wins)', () => {
    const parsed = parseInterface('{ watch: (on: (s: Signal) -> .) -> . }');
    expect(parsed.watch).toEqual([
      { params: [{ name: 'on', type: '(s: Signal) -> .', positional: false }], returns: null },
    ]);
  });

  it('keeps a reply-callback parameter intact and parses the real return', () => {
    const parsed = parseInterface('{ run: (cb: (n: Integer) -> (ok: Boolean)) -> (count: Integer) }');
    expect(parsed.run).toEqual([
      {
        params: [{ name: 'cb', type: '(n: Integer) -> (ok: Boolean)', positional: false }],
        returns: [{ name: 'count', type: 'Integer', positional: false }],
      },
    ]);
  });

  it('a plain (no-callback) method still parses as before', () => {
    const parsed = parseInterface('{ lookup: (key: Text) -> (value: Text) }');
    expect(parsed.lookup).toEqual([
      {
        params: [{ name: 'key', type: 'Text', positional: false }],
        returns: [{ name: 'value', type: 'Text', positional: false }],
      },
    ]);
  });
});
