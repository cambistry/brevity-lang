import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extract, compile } from '../../index.js';
import { tokenize } from '../../src/lexer.js';
import { parse } from '../../src/parser.js';

// Garbage doesn't compile silently. Programs from this suite's own sources, each
// changed by one token: deleted, duplicated, swapped with the next, or a stray
// token put in front of it. A mutant must be rejected, or fall under an accepted
// equivalence below (each with its reason). Anything else is reported with the
// program, the mutation and the seed, for triage: a parser bug to fix, or a new
// equivalence.
//
// The suite runs a fixed sample. A wider sweep: MUTATION_SWEEP=1 (random seed,
// printed), or MUTATION_SEED=<n> to rerun one; npm run test:mutants.

const TESTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const SWEEP = !!process.env.MUTATION_SWEEP || !!process.env.MUTATION_SEED;
const SEED = +(process.env.MUTATION_SEED || (process.env.MUTATION_SWEEP ? Date.now() % 1e9 : 1));
const PROGRAMS = SWEEP ? Infinity : 300;
const PER_PROGRAM = SWEEP ? 20 : 4;

const rng = (seed) => () => {
  seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

// ── The corpus: string and template literals in __tests__ that compile ──────

// A JS file's string and template literals, unescaped. A template with `${` is left out.
function literals(js) {
  const out = [];
  let i = 0, prev = '';
  const regexOk = () => /[(,=:[!&|?{};]$|^$|return$|typeof$/.test(prev);
  while (i < js.length) {
    const c = js[i];
    if (c === '/' && js[i + 1] === '/') { while (i < js.length && js[i] !== '\n') i++; continue; }
    if (c === '/' && js[i + 1] === '*') { i = js.indexOf('*/', i + 2) + 2; continue; }
    if (c === '/' && regexOk()) {
      i++;
      let inClass = false;
      while (i < js.length && (js[i] !== '/' || inClass)) {
        if (js[i] === '\\') i++;
        else if (js[i] === '[') inClass = true;
        else if (js[i] === ']') inClass = false;
        i++;
      }
      i++;
      while (/[a-z]/.test(js[i])) i++;
      prev = 'x';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1, text = '', interp = false;
      while (j < js.length && js[j] !== c) {
        if (js[j] === '\\') { const e = js[j + 1]; text += e === 'n' ? '\n' : e === 't' ? '\t' : e; j += 2; continue; }
        if (c === '`' && js[j] === '$' && js[j + 1] === '{') {
          interp = true;
          for (let depth = 0; j < js.length; j++) { if (js[j] === '{') depth++; if (js[j] === '}' && --depth === 0) break; }
          j++;
          continue;
        }
        text += js[j++];
      }
      if (!interp) out.push(text);
      i = j + 1;
      prev = 'x';
      continue;
    }
    if (!/\s/.test(c)) prev = (prev + c).slice(-20);
    i++;
  }
  return out;
}

function corpus() {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.test.js') && p !== fileURLToPath(import.meta.url)) files.push(p);
    }
  };
  walk(TESTS);
  const seen = new Set();
  const programs = [];
  for (const f of files) {
    for (const src of literals(readFileSync(f, 'utf8'))) {
      if (src.length < 8 || !/[=@]/.test(src) || seen.has(src)) continue;
      seen.add(src);
      try { compile(extract(src).ast, { target: 'js' }); programs.push(src); } catch { /* not a program on its own */ }
    }
  }
  return programs;
}

// ── Mutations ───────────────────────────────────────────────────────────────

const STRAYS = ['@', '#', '*', '&', '+', ':', '|', '**', 'zz', '.', '!', ',', '=', '->', '?'];
const LINE = new Set(['NEWLINE', 'BLOCK_SEP']);
const kindOf = (t) => (t ? t.type + ':' + (t.value ?? '') : '');

// Each token's text in the source: up to the next token, without trailing space or a comment.
function segments(src, toks) {
  return toks.slice(0, -1).map((t, k) => {
    let text = src.slice(t.start, toks[k + 1].start);
    if (LINE.has(t.type)) text = text.match(/^[^\n;]*[\n;]/)?.[0] ?? text;
    else if (t.type !== 'STRING' && t.type !== 'INTERP_STRING') text = text.replace(/\s*\/\/.*$/s, '').replace(/\s+$/, '');
    else text = text.replace(/\s+$/, '');
    return { ...t, end: t.start + text.length, text, prev: k ? kindOf(toks[k - 1]) : '^', next: kindOf(toks[k + 1]) || '$' };
  }).filter((t, k, all) => t.text.length && (k === all.length - 1 || t.start < all[k + 1].start));
}

function mutate(src, rand) {
  const seg = segments(src, tokenize(src));
  const k = Math.floor(rand() * seg.length);
  const t = seg[k];
  const kind = ['delete', 'duplicate', 'swap', 'insert'][Math.floor(rand() * 4)];
  if (!t) return null;
  const at = { kind, type: t.type, text: t.text, start: t.start, prev: t.prev, next: t.next };
  if (kind === 'delete') return { ...at, out: src.slice(0, t.start) + src.slice(t.end) };
  if (kind === 'duplicate') return { ...at, out: src.slice(0, t.end) + (LINE.has(t.type) ? '' : ' ') + t.text + src.slice(t.end) };
  if (kind === 'swap') {
    const u = seg[k + 1];
    if (!u) return null;
    return { ...at, withType: u.type, out: src.slice(0, t.start) + u.text + src.slice(t.end, u.start) + t.text + src.slice(u.end) };
  }
  const stray = STRAYS[Math.floor(rand() * STRAYS.length)];
  return { ...at, stray, out: src.slice(0, t.start) + stray + ' ' + src.slice(t.start) };
}

const signature = (toks) => toks.map(t => `${t.type}:${t.value ?? ''}`).join(' ');
const astJson = (ast) => JSON.stringify(ast, (k, v) => (k === 'loc' ? undefined : v));

// What a mutant is: 'rejected', or the outcome to classify.
function judge(src, m) {
  let toks;
  try { toks = tokenize(m.out); } catch { return 'rejected'; }
  if (signature(toks) === signature(tokenize(src))) return 'same-tokens';
  let ast;
  try { ast = parse(toks); } catch (e) { return /^Parser bug/.test(e.message) ? `parser bug: ${e.message}` : 'rejected'; }
  const same = astJson(ast) === astJson(parse(tokenize(src)));
  try { compile(ast, { target: 'js' }); } catch (e) { return /^Parser bug/.test(e.message) ? `parser bug: ${e.message}` : 'rejected'; }
  return same ? 'same-ast' : 'different-ast';
}

// ── Accepted equivalences ───────────────────────────────────────────────────

const ty = (s) => s.split(':')[0];
const BRACKETS = ['LBRACE', 'LPAREN', 'LBRACKET', 'RBRACE', 'RPAREN', 'RBRACKET', 'COMMA'];
const SEPARATORS = ['COMMA', 'NEWLINE', 'BLOCK_SEP', 'LPAREN', 'RPAREN', 'LBRACE', 'RBRACE', 'LBRACKET', 'RBRACKET'];
const SIGILS = {
  '*': 'a cell, a ref, a class or a factory', '@': 'a public name', '->': 'a function', ':': 'a named param or a rename',
  '?': 'an optional field or a predicate name', '!': 'a writing name', '.': 'a silent name', '&': 'a function reference',
};

// The equivalence a mutant that compiled falls under, or null.
function accepted(m, outcome, src) {
  const lineOnly = LINE.has(m.type) && (m.kind !== 'swap' || LINE.has(m.withType));
  const lineSwap = m.kind === 'swap' && (LINE.has(m.type) || LINE.has(m.withType));
  const [p, n] = [ty(m.prev), ty(m.next)];
  if (outcome === 'same-tokens') return lineOnly ? 'blank lines collapse' : null;
  if (outcome === 'same-ast') {
    if (m.type === 'DIVIDER' || m.withType === 'DIVIDER') return 'a stitch has no weight';
    if (LINE.has(m.type) && (m.kind === 'duplicate' || (m.type === 'BLOCK_SEP' && m.kind === 'delete'))) return 'a blank line that ends nothing';
    if (lineSwap && (BRACKETS.includes(m.type) || BRACKETS.includes(m.withType))) return 'a line break beside a bracket or comma';
    if (lineSwap) return 'a line break moved across a token at a line\'s edge';
    if (lineOnly) {
      if (p === '^' || n === '$' || n === 'EOF') return 'line breaks at the edge of a file';
      if (['LBRACE', 'LPAREN', 'LBRACKET', 'COMMA', 'EQUALS', '->'].includes(p) || ['RBRACE', 'RPAREN', 'RBRACKET', 'COMMA', 'EQUALS', 'LBRACE'].includes(n)) return 'a line break beside a bracket, comma or opener';
      if (m.prev === 'KEYWORD:return') return 'a return\'s value may be on the next line';
      if (m.next.startsWith('KEYWORD:else')) return 'a line break before `else` is whitespace';
      if (n === 'DOT' || p === 'DOT') return 'a lineal body\'s `.` may end its last line';
    }
    if (m.type === 'EQUALS' && m.kind === 'duplicate') return '`= =` is the explicit empty params';
    if (m.kind === 'insert' && m.stray === '=' && (p === 'EQUALS' || m.type === 'EQUALS')) return '`= =` is the explicit empty params';
    if (m.kind === 'delete' && m.type === 'EQUALS' && (p === 'EQUALS' || n === 'EQUALS' || LINE.has(p) && ty(m.next) === 'EQUALS')) return '`= =` is the explicit empty params';
    if (m.kind === 'delete' && m.type === 'HASH_IDENT' && m.prev === 'KEYWORD:end') return '`end`\'s label is optional';
    if (m.kind === 'insert' && m.stray === ',' && (['RPAREN', 'RBRACE', 'RBRACKET', 'EQUALS'].includes(m.type) || LINE.has(m.type))) return 'a trailing comma';
    if (m.kind === 'insert' && m.stray === '->' && ['LBRACE', 'STAR'].includes(m.type)) return '`->` before a body is optional';
    if (m.kind === 'delete' && m.type === '->' && (n === 'LBRACE' || n === 'LPAREN' || n === 'STAR')) return '`->` before a body or a signature\'s returns is optional';
    if (m.kind === 'delete' && m.type === 'KEYWORD' && m.text === 'return') return n === 'SIGIL' ? 'a sigil tail is its reply: `:x` is `return :x`' : '`return` is optional before a tail value';
    if (m.kind === 'delete' && m.type === 'KEYWORD' && m.text === 'self') return 'in a `!` function, a bare `return` is `return self`';
    if (m.kind === 'delete' && m.type === 'COLON') return 'in a signature, `name: Type` is `name Type`';
    if (m.kind === 'delete' && m.type === 'IDENT' && n === 'EQUALS') return 'a param\'s type may be inferred from its default';
    if (m.type === 'STAR' || m.stray === '*') return 'a header param\'s `*` grants writes; nothing here writes it';
    // Open questions, kept visible: decide and turn into a rule or a fix.
    if (m.kind === 'delete' && m.type === 'EQUALS' && (p === 'IDENT' || LINE.has(p))) return 'OPEN: a declaration may leave out its `=`: `f -> x` is `f = -> x`';
    if (m.kind === 'swap' && m.type === 'IDENT' && m.withType === 'COLON') return 'OPEN: a class param `:name *` is `name: *`';
    if (m.kind === 'delete' && m.type === 'STAR' && LINE.has(n)) return 'OPEN: a lineal class with no params may drop its `*`';
    return null;
  }
  // A different program that compiles.
  if (m.kind === 'delete' && m.type === 'AT') return 'a name without `@` is the private name';
  if (m.kind === 'delete' && !SEPARATORS.includes(m.type)) return 'deleting an optional part (an annotation, a sigil, an argument, a value) leaves another program; arity isn\'t checked yet';
  if (m.kind === 'insert' && SIGILS[m.stray]) return `inserting \`${m.stray}\` makes ${SIGILS[m.stray]}`;
  if (m.kind === 'insert' && m.stray === 'zz') return 'a name inserted renames, or starts a lineal declaration';
  if (m.kind === 'insert' && m.stray === ',' && (['RPAREN', 'RBRACE', 'RBRACKET', 'EQUALS'].includes(m.type) || LINE.has(m.type))) return 'a trailing comma, or `a, = x` destructuring the first';
  if (m.kind === 'insert' && m.stray === '=' && (p === 'EQUALS' || LINE.has(m.type))) return '`= =` is the explicit empty params, or a line opens a lineal body';
  if (m.kind === 'swap' && (m.type === 'COMMA' || m.withType === 'COMMA')) return 'a comma moved to a list\'s end is a trailing comma';
  if (LINE.has(m.type) && m.kind === 'duplicate') return 'a blank line ends a lineal body';
  if (LINE.has(m.type) && m.kind === 'delete' && p === 'DOT') return 'a `.` then a name on the same line is member access';
  if (LINE.has(m.type) && m.kind === 'delete' && /\/\/[^\n]*$/.test(src.slice(0, m.start))) return 'a line break deleted after a comment comments out what follows';
  if ((m.kind === 'swap' || m.kind === 'duplicate') && !SEPARATORS.includes(m.type) && !SEPARATORS.includes(m.withType ?? 'x')) return 'a swap or duplication that rearranges into another program: names, args and types reorder';
  if (lineSwap || (m.kind === 'swap' && (BRACKETS.includes(m.type) || BRACKETS.includes(m.withType)))) return 'a line break or bracket moved splits or joins into another program';
  return null;
}

// ── The run ──────────────────────────────────────────────────────────────────

describe('mutants of valid programs', () => {
  it(`are rejected, or fall under an accepted equivalence (seed ${SEED})`, () => {
    const rand = rng(SEED);
    const programs = corpus();
    const sample = PROGRAMS >= programs.length ? programs : Array.from({ length: PROGRAMS }, () => programs[Math.floor(rand() * programs.length)]);
    const unaccepted = [];
    for (const src of sample) {
      for (let i = 0; i < PER_PROGRAM; i++) {
        const m = mutate(src, rand);
        if (!m || m.out === src) continue;
        const outcome = judge(src, m);
        if (outcome === 'rejected') continue;
        if (!outcome.startsWith('parser bug') && accepted(m, outcome, src)) continue;
        unaccepted.push({ outcome, mutation: `${m.kind} ${m.type} '${m.text}'${m.stray ? ` with '${m.stray}'` : ''}`, program: src, mutant: m.out });
      }
    }
    if (unaccepted.length) {
      // Where the mutant differs, with a little of the program around it.
      const around = (u) => {
        let a = 0;
        while (u.program[a] === u.mutant[a]) a++;
        const from = Math.max(0, a - 80);
        return `--- program\n${u.program.slice(from, a + 80)}\n--- mutant\n${u.mutant.slice(from, a + 80)}`;
      };
      const shown = unaccepted.slice(0, +(process.env.MUTATION_SHOW || 5)).map(u => `${u.outcome}: ${u.mutation}\n${around(u)}`).join('\n\n');
      throw new Error(`${unaccepted.length} mutants compiled with no accepted equivalence (MUTATION_SEED=${SEED}):\n\n${shown}`);
    }
  }, 600000);
});
