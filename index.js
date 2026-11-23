import { tokenize } from './src/lexer.js';
import { parse } from './src/parser.js';
import { validate, readRemote } from './src/validate.js';
import { renamePublicClasses, validateWithSourceNames } from './src/subclass.js';
import { loadTargets, getTarget, getTargetNames } from './src/codegen/targets.js';
import { runExtractPasses } from './src/extract_passes.js';
import { RUNTIME_MODULE } from './src/codegen/erlang/preambles.js';
import { serviceShape, settleOverrideTables } from './src/service_shape.js';
import { serviceDocument, fileScope } from './src/service_doc.js';

await loadTargets();

// A param as the params document writes it. A public class has no `@` there.
function formatParam(param) {
  const opt = (param.defaultValue || param.optional) ? '? ' : '';
  if (!param?.type) return `${opt}Anything`;
  const type = param.type.replace(/@(?=\w)/g, '');
  if (param.positional) return `${opt}${type}`;
  return `${opt}${param.key || param.name}: ${type}`;
}

// One entry of the params document: the caller-facing side of a header entry.
// Bindings are private and dropped — a positional param's name, a renamed
// param's local, a dependency's alias or destructure. A positional entry is
// its type; a named entry is `"key": Type`, and a dependency with no declared
// type (it comes from the remote's own document) is `"key":`. Every named key
// is quoted: keys are paths.
function renderParamsEntry(entry) {
  if (entry.type === 'FileParam') {
    const typeName = entry.paramType || 'Anything';
    if (entry.positional) return typeName;
    return `${renderParamsKey(entry.key || entry.name)}: ${typeName}`;
  }
  const key = renderParamsKey(entry.path);
  const type = dependencyTypeText(entry);
  return type ? `${key}: ${type.replace(/\n/g, '\n  ')}` : `${key}:`;
}

function renderParamsKey(key) {
  return JSON.stringify(key);
}

function dependencyTypeText(dep) {
  if (dep.constructorParams) {
    const params = dep.constructorParams.map(p => formatParam(p)).join(', ');
    return `(${params}) -> *${dep.interface || '{}'}`;
  }
  return dep.interface || null;
}

function buildParamsDocument(ast) {
  const entries = (ast.dependencies || [])
    .filter(d => d.type === 'FileParam' || (d.type === 'Dependency' && d.path))
    .map(renderParamsEntry);
  // Same outer shape as a delimited header's param list: `( … )`.
  if (entries.length === 0) return '()';
  return '(\n  ' + entries.join('\n  ') + '\n)';
}

// The documents of the services a file uses, by path, for what its own says of
// them. A malformed one is reported by validation, with the context to explain it.
function remoteDocsByPath(ast, remotes) {
  const docs = {};
  const entries = Array.isArray(remotes) ? remotes.map(r => [r.path, r.service, r.params])
    : Object.entries(remotes || {}).map(([name, service]) => [(ast.dependencies || []).find(d => d.name === name)?.path ?? name, service]);
  for (const [path, service, params] of entries) {
    try { docs[path] = readRemote(service, { path, params }).doc; } catch { /* reported by validation */ }
  }
  return docs;
}

// `remotes` (`[{ path, service }]`, as compile takes): the documents of the files
// this one uses, for what the parse needs of them (a parent class from another
// file) and what the file's own document says of them.
export function extract(source, { remotes = null } = {}) {
  if (typeof source !== 'string') {
    throw new TypeError('extract expects a string');
  }
  const tokens = tokenize(source);
  const ast = parse(tokens, { remotes });
  runExtractPasses(ast);
  const remoteDocs = remoteDocsByPath(ast, remotes);
  return {
    ast,
    interface: {
      structures: [],
      params: buildParamsDocument(ast),
      service: serviceDocument(serviceShape(ast, remoteDocs), fileScope(ast, remoteDocs)),
    },
  };
}

// The Erlang target's shared runtime, brevity_rt.erl. Every module the Erlang
// target emits imports it, so it is compiled and loaded beside them.
export function erlangRuntime() {
  return RUNTIME_MODULE;
}

export { settleOverrideTables };

export function compile(ast, options = {}) {
  settleOverrideTables(ast);
  renamePublicClasses(ast);
  validateWithSourceNames(validate, ast, options);
  const name = options.target || process.env.BREVITY_TARGET || 'js';
  const target = getTarget(name);
  if (!target) {
    throw new Error(`Unknown BREVITY_TARGET: '${name}'. Valid targets: ${getTargetNames().join(', ')}`);
  }
  return target.codegen(ast, options);
}
