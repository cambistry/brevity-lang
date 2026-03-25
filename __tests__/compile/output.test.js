import compile from '../../index.js';

describe('compile', () => {
  let result;

  beforeEach(() => {
    result = compile('');
  });

  it('returns an output key', () => {
    expect(result).toHaveProperty('output');
  });

  it('returns a manifest key', () => {
    expect(result).toHaveProperty('manifest');
  });

  it('returns a sourcemap key', () => {
    expect(result).toHaveProperty('sourcemap');
  });

  it('returns an errors key', () => {
    expect(result).toHaveProperty('errors');
  });

  it('throws when input is not a string', () => {
    expect(() => compile(123)).toThrow(TypeError);
  });

  it('returns a service manifest document with function signatures', () => {
    const source = `
      @do_this
        =
        a : Text
        :b : Integer
        =
        ->(output: value : Boolean)
    `;

    const compiled = compile(source);

    expect(compiled.manifest).toEqual({
      structures: [],
      service: '{\n  @do_this: (Text, b: Integer) -> (output: Boolean)\n}',
    });
  });
});
