import { tokenize } from './src/lexer.js';
import { parse } from './src/parser.js';
import { validate } from './src/validate.js';
import { codegen } from './src/codegen/javascript/index.js';
import { codegenRust } from './src/codegen/rust/index.js';
import { codegenErlang } from './src/codegen/erlang/index.js';

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

function formatPublicFnSig(fn) {
  const input = fn.params.map(formatParam).join(', ');
  const reply = fn.body.find(stmt => stmt.type === 'Reply');
  if (!reply) return `(${input}) -> .`;
  const output = reply.fields.map(formatReplyField).join(', ');
  return `(${input}) -> (${output})`;
}

function formatConstructorSig(actor) {
  const input = actor.params.map(formatParam).join(', ');
  const methods = actor.functions.filter(f => f.name && f.name.startsWith('@'));
  const methodLines = methods.map(fn => {
    const name = fn.name.replace(/^@/, '');
    const sig = formatPublicFnSig(fn);
    return `    ${name}: ${sig}`;
  });
  return `<${input}> -> {\n${methodLines.join('\n')}\n  }`;
}

function buildServiceDocument(ast) {
  const lines = [];
  for (const actor of ast.actors) {
    // Public constructor: actor with @-prefixed name
    if (actor.name && actor.name.startsWith('@')) {
      const name = actor.name.replace(/^@/, '');
      lines.push(`${name}: ${formatConstructorSig(actor)}`);
      continue;
    }
    // Public functions within this actor
    const grouped = new Map();
    for (const fn of actor.functions.filter(f => f.name && f.name.startsWith('@'))) {
      if (!grouped.has(fn.name)) grouped.set(fn.name, []);
      grouped.get(fn.name).push(formatPublicFnSig(fn));
    }
    for (const [op, sigs] of grouped) {
      lines.push(`${op.replace(/^@/, '')}: ${sigs.join(' | ')}`);
    }
  }

  if (lines.length === 0) return '{\n}';
  return `{\n  ${lines.join('\n  ')}\n}`;
}

export default function compile(source, options = {}) {
  if (typeof source !== 'string') {
    throw new TypeError('compile expects a string');
  }

  const tokens = tokenize(source);
  const ast = parse(tokens);
  validate(ast, options);
  const target = options.target || process.env.BREVITY_TARGET || 'js';
  if (!['js', 'rust', 'erlang'].includes(target)) {
    throw new Error(`Unknown BREVITY_TARGET: '${target}'. Valid targets: js, rust, erlang`);
  }
  const remotes = options.remotes || null;
  const output = target === 'rust' ? codegenRust(ast) : target === 'erlang' ? codegenErlang(ast) : codegen(ast, { remotes });

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
