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

  it('returns a useDecls key', () => {
    expect(result).toHaveProperty('useDecls');
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
      service: '{\n  do_this: (Text, :b Integer) -> (:output Boolean)\n}',
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
