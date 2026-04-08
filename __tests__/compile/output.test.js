import { extract, compile } from '../../index.js';

describe('extract', () => {
  let result;

  beforeEach(() => {
    result = extract('');
  });

  it('returns an ast key', () => {
    expect(result).toHaveProperty('ast');
  });

  it('returns a manifest key', () => {
    expect(result).toHaveProperty('manifest');
  });

  it('returns a useDecls key', () => {
    expect(result).toHaveProperty('useDecls');
  });

  it('throws when input is not a string', () => {
    expect(() => extract(123)).toThrow(TypeError);
  });

  it('returns a service manifest document with function signatures', () => {
    const source = `
      @do_this
        =
        a Text
        :b Integer
        =
        ->(output: value as Boolean)
    `;

    const { manifest } = extract(source);

    expect(manifest).toEqual({
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
