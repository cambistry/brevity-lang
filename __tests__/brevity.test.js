const vm = require('vm');
const compile = require('..');

function run(code) {
  vm.runInNewContext(code);
}

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
});

describe('output execution', () => {
  it('empty script produces output that runs without error', () => {
    const { output } = compile('');
    expect(() => run(output)).not.toThrow();
  });

  it('malformed JS throws when run (confirms runner is not a no-op)', () => {
    expect(() => run('const = ;')).toThrow();
  });
});
