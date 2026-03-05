import { tokenize } from './src/lexer.js';
import { parse } from './src/parser.js';
import { codegen } from './src/codegen.js';

export default function compile(source) {
  if (typeof source !== 'string') {
    throw new TypeError('compile expects a string');
  }

  const tokens = tokenize(source);
  const ast = parse(tokens);
  const output = codegen(ast);

  return {
    output,
    manifest: { structures: [] },
    sourcemap: null,
    errors: [],
  };
}
