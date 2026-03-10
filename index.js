import { tokenize } from './src/lexer.js';
import { parse } from './src/parser.js';
import { codegen } from './src/codegen.js';

function formatParam(param) {
  if (!param?.type) return 'Anything';
  if (param.positional) return param.type;
  return `${param.name}: ${param.type}`;
}

function formatReplyField(field, index) {
  if (!field?.type) return `arg${index + 1}: Anything`;
  if (field.positional) return field.type;
  if ('sigil' in field) return `${field.sigil}: ${field.type}`;
  if (field.key !== undefined) return `${field.key}: ${field.type}`;
  return `arg${index + 1}: ${field.type}`;
}

function formatHandlerSignature(handler) {
  const input = handler.params.map(formatParam).join(', ');
  const reply = handler.body.find(stmt => stmt.type === 'Reply');
  const output = reply
    ? reply.fields.map(formatReplyField).join(', ')
    : 'Nothing';
  return `${handler.op}: (${input}) -> (${output})`;
}

function buildServiceDocument(ast) {
  const signatures = [];
  for (const actor of ast.actors) {
    for (const handler of actor.handlers) {
      signatures.push(formatHandlerSignature(handler));
    }
  }

  if (signatures.length === 0) return '{\n}';
  return `\{\n  ${signatures.join('\n  ')}\n\}`;
}

export default function compile(source) {
  if (typeof source !== 'string') {
    throw new TypeError('compile expects a string');
  }

  const tokens = tokenize(source);
  const ast = parse(tokens);
  const output = codegen(ast);

  return {
    output,
    manifest: {
      structures: [],
      service: buildServiceDocument(ast),
    },
    sourcemap: null,
    errors: [],
  };
}
