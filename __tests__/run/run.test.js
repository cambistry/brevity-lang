import { extract, compile } from '../../index.js';
import { run } from '../helpers.js';

describe('output execution', () => {
  it('empty script produces output that runs without error', () => {
    const { ast } = extract('');
    const output = compile(ast);
    expect(() => run(output)).not.toThrow();
  });

  it('malformed JS throws when run (confirms runner is not a no-op)', () => {
    expect(() => run('const = ;')).toThrow();
  });
});
