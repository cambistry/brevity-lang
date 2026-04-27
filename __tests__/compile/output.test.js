import { extract, compile } from '../../index.js';

describe('extract', () => {
  let result;

  beforeEach(() => {
    result = extract('');
  });

  it('returns an ast key', () => {
    expect(result).toHaveProperty('ast');
  });

  it('returns an interface key', () => {
    expect(result).toHaveProperty('interface');
  });

  it('throws when input is not a string', () => {
    expect(() => extract(123)).toThrow(TypeError);
  });

  it('returns an interface document with function signatures', () => {
    const source = `
      @do_this
        =
        a Text
        :b Integer
        =
        ->(output: value as Boolean)
    `;

    const { interface: iface } = extract(source);

    expect(iface).toEqual({
      structures: [],
      params: '<>',
      service: '{\n  do_this: (Text, b: Integer) -> (output: Boolean)\n}',
    });
  });

  it('non-empty params render alongside service', () => {
    const source = `
      <
        "/db": (DB) { lookup: (key: Text) -> (value: Text) }
        :limit Integer
      >

      @fetch = |:key Text| -> value: "ok"
    `;

    const { interface: iface } = extract(source);

    expect(iface).toEqual({
      structures: [],
      params: '<\n  :"/db"\n  :limit Integer\n>',
      service: '{\n  fetch: (key: Text) -> (value: Text)\n}',
    });
  });
});

describe('compile', () => {
  it('returns a string', () => {
    const { ast } = extract('');
    const output = compile(ast);
    expect(typeof output).toBe('string');
  });
});
