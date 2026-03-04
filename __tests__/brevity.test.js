const Brevity = require('..');

describe('Brevity', () => {
  it('trims whitespace from text', () => {
    const brevity = Brevity();
    expect(brevity.summarize('  Keep it short.  ')).toBe('Keep it short.');
  });

  it('throws when input is not a string', () => {
    const brevity = Brevity();
    expect(() => brevity.summarize(123)).toThrow(TypeError);
  });
});
