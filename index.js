import { tokenize } from './src/lexer.js';
import { parse } from './src/parser.js';
import { codegen } from './src/codegen.js';
import { codegenRust } from './src/codegen-rs.js';
import { codegenErlang } from './src/codegen-erl.js';

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

function formatHandlerSig(handler) {
  const input = handler.params.map(formatParam).join(', ');
  const reply = handler.body.find(stmt => stmt.type === 'Reply');
  if (!reply) return `(${input}) -> .`;
  const output = reply.fields.map(formatReplyField).join(', ');
  return `(${input}) -> (${output})`;
}

function buildServiceDocument(ast) {
  const grouped = new Map();
  for (const actor of ast.actors) {
    for (const handler of actor.handlers) {
      if (!grouped.has(handler.op)) grouped.set(handler.op, []);
      grouped.get(handler.op).push(formatHandlerSig(handler));
    }
  }

  if (grouped.size === 0) return '{\n}';
  const lines = [];
  for (const [op, sigs] of grouped) {
    lines.push(`${op}: ${sigs.join(' | ')}`);
  }
  return `{\n  ${lines.join('\n  ')}\n}`;
}

export default function compile(source, options = {}) {
  if (typeof source !== 'string') {
    throw new TypeError('compile expects a string');
  }

  const tokens = tokenize(source);
  const ast = parse(tokens);
  const target = options.target || 'js';
  const output = target === 'rust' ? codegenRust(ast) : target === 'erlang' ? codegenErlang(ast) : codegen(ast);

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
