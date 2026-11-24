#!/usr/bin/env node
// Terminal kanban board over ../kanban/tickets.
// Status lives in each ticket's front-matter (main branch). Order lives in
// lists/<status> on this branch, one repo-relative ticket path per line.
// Each finished move commits and pushes lists/; while open, the board polls
// origin and rebases onto other stations' moves.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TICKETS = path.resolve(HERE, '..', 'kanban', 'tickets');
const REPO = path.resolve(HERE, '..');
const ORDER_DIR = path.join(HERE, 'lists');
const COLUMNS_FILE = path.join(HERE, 'columns');
const BRANCH = 'kanban';
const POLL_MS = (Number(process.env.KANBAN_POLL) || 15) * 1000;

// ---------- data ----------

function loadColumns() {
  const main = [];
  const parked = [];
  let target = main;
  for (const raw of fs.readFileSync(COLUMNS_FILE, 'utf8').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    if (line === '---') { target = parked; continue; }
    const [slug, ...name] = line.split(/\s+/);
    target.push({ slug, name: name.join(' ') || slug });
  }
  return { main, parked };
}

function parseTicket(slug, text) {
  const fields = {};
  let body = text;
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (m) fields[m[1]] = m[2].trim();
    }
    body = text.slice(fm[0].length);
  }
  const heading = body.match(/^#\s+(.+)$/m);
  return {
    slug,
    file: path.join(TICKETS, `${slug}.md`),
    title: heading ? heading[1].trim() : slug,
    status: fields.status || 'inbox',
    created: fields.created || '',
  };
}

function loadTickets() {
  const tickets = new Map();
  if (!fs.existsSync(TICKETS)) return tickets;
  for (const name of fs.readdirSync(TICKETS)) {
    if (!name.endsWith('.md')) continue;
    const slug = name.slice(0, -3);
    tickets.set(slug, parseTicket(slug, fs.readFileSync(path.join(TICKETS, name), 'utf8')));
  }
  return tickets;
}

function ticketPath(slug) {
  return path.relative(REPO, path.join(TICKETS, `${slug}.md`));
}

function slugOfPath(line) {
  const abs = path.resolve(REPO, line);
  return path.dirname(abs) === TICKETS && abs.endsWith('.md') ? path.basename(abs, '.md') : null;
}

// One list per status. A ticket's status (front-matter) decides its column;
// the column's list decides its position. Tickets missing from their list go
// to the top, newest first.
function loadLists(tickets) {
  const lists = new Map();
  const files = fs.existsSync(ORDER_DIR) ? fs.readdirSync(ORDER_DIR).filter(f => !f.startsWith('.')) : [];
  for (const status of files) {
    const slugs = fs.readFileSync(path.join(ORDER_DIR, status), 'utf8').split('\n')
      .map(l => l.trim()).filter(Boolean).map(slugOfPath)
      .filter(s => s && tickets.has(s) && tickets.get(s).status === status);
    lists.set(status, [...new Set(slugs)]);
  }
  const listed = new Set([...lists.values()].flat());
  const unlisted = [...tickets.values()].filter(t => !listed.has(t.slug))
    .sort((a, b) => a.created.localeCompare(b.created) || b.slug.localeCompare(a.slug));
  for (const t of unlisted) {
    if (!lists.has(t.status)) lists.set(t.status, []);
    lists.get(t.status).unshift(t.slug);
  }
  return lists;
}

function writeStatus(ticket, status) {
  const text = fs.readFileSync(ticket.file, 'utf8');
  let out;
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) out = `---\nstatus: ${status}\n---\n${text}`;
  else if (/^status:.*$/m.test(fm[1])) out = `---\n${fm[1].replace(/^status:.*$/m, `status: ${status}`)}\n---\n${text.slice(fm[0].length)}`;
  else out = `---\nstatus: ${status}\n${fm[1]}\n---\n${text.slice(fm[0].length)}`;
  fs.writeFileSync(ticket.file, out);
}

function slugify(title) {
  let s = title.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 60) s = s.slice(0, 60).replace(/-[^-]*$/, '');
  return s || 'untitled';
}

function today() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- board model ----------

const S = {
  columns: null,
  tickets: null,
  lists: null,
  view: 'main',
  col: 0,
  rows: {},
  scroll: {},
  grab: null,
  prompt: null,
  message: '',
  editing: false,
  peek: null,
  stale: false,
};

function reload() {
  S.columns = loadColumns();
  S.tickets = loadTickets();
  S.lists = loadLists(S.tickets);
}

function knownSlugs() {
  return new Set([...S.columns.main, ...S.columns.parked].map(c => c.slug));
}

function unknownColumns() {
  const known = knownSlugs();
  const extra = [...new Set([...S.tickets.values()].map(t => t.status))].filter(s => !known.has(s)).sort();
  return extra.map(slug => ({ slug, name: `?${slug}` }));
}

function viewColumns(view = S.view) {
  return view === 'main' ? [...S.columns.main, ...unknownColumns()] : S.columns.parked;
}

function members(colSlug) {
  return S.lists.get(colSlug) || [];
}

function currentColumn() {
  return viewColumns()[S.col];
}

function currentRow() {
  const c = currentColumn();
  return c ? Math.min(S.rows[c.slug] || 0, Math.max(0, members(c.slug).length - 1)) : 0;
}

function selected() {
  const c = currentColumn();
  return c ? S.tickets.get(members(c.slug)[currentRow()]) : undefined;
}

// Put `slug` at position `row` among the members of column `colSlug`.
function place(slug, colSlug, row) {
  for (const [status, list] of S.lists) S.lists.set(status, list.filter(s => s !== slug));
  const list = members(colSlug);
  list.splice(clamp(row, 0, list.length), 0, slug);
  S.lists.set(colSlug, list);
}

function copyLists(lists) {
  return new Map([...lists].map(([k, v]) => [k, [...v]]));
}

function writeOrder() {
  fs.mkdirSync(ORDER_DIR, { recursive: true });
  for (const [status, list] of S.lists) {
    const file = path.join(ORDER_DIR, status);
    if (!list.length && !fs.existsSync(file)) continue;
    fs.writeFileSync(file, list.map(s => `${ticketPath(s)}\n`).join(''));
  }
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function moveCursor(dc, dr) {
  const cols = viewColumns();
  if (dc) S.col = clamp(S.col + dc, 0, cols.length - 1);
  const c = currentColumn();
  if (dr && c) S.rows[c.slug] = clamp(currentRow() + dr, 0, Math.max(0, members(c.slug).length - 1));
}

function moveGrabbed(dc, dr) {
  const g = S.grab;
  const t = S.tickets.get(g.slug);
  const cols = viewColumns();
  if (dc) {
    const nc = clamp(S.col + dc, 0, cols.length - 1);
    if (nc === S.col) return;
    const row = currentRow();
    t.status = cols[nc].slug;
    place(g.slug, t.status, row);
    S.col = nc;
  } else if (dr) {
    const m = members(t.status);
    const i = m.indexOf(g.slug);
    const ni = clamp(i + dr, 0, m.length - 1);
    if (ni === i) return;
    place(g.slug, t.status, ni);
  }
  S.rows[t.status] = members(t.status).indexOf(g.slug);
}

function toggleView() {
  const next = S.view === 'main' ? 'parked' : 'main';
  const cols = viewColumns(next);
  if (!cols.length) { S.message = 'no parked columns'; return; }
  S.view = next;
  S.col = clamp(S.col, 0, cols.length - 1);
  if (S.grab) {
    const t = S.tickets.get(S.grab.slug);
    t.status = cols[S.col].slug;
    place(t.slug, t.status, 0);
    S.rows[t.status] = 0;
  }
}

function grabOrDrop() {
  if (!S.grab) {
    const t = selected();
    if (!t) return;
    S.grab = { slug: t.slug, lists: copyLists(S.lists), status: t.status };
    return;
  }
  const t = S.tickets.get(S.grab.slug);
  const row = members(t.status).indexOf(t.slug);
  if (t.status !== S.grab.status) writeStatus(t, t.status);
  S.grab = null;
  if (S.stale) {
    // Lists changed on disk during the move: reload them, then re-apply only this move.
    S.stale = false;
    reload();
    place(t.slug, S.tickets.get(t.slug).status, row);
    focusSlug(t.slug);
  }
  writeOrder();
  publish();
}

function cancelGrab() {
  if (!S.grab) return;
  const t = S.tickets.get(S.grab.slug);
  S.lists = S.grab.lists;
  t.status = S.grab.status;
  S.grab = null;
  if (S.stale) { S.stale = false; reload(); }
  focusSlug(t.slug);
}

function focusSlug(slug) {
  const t = S.tickets.get(slug);
  if (!t) return;
  for (const view of ['main', 'parked']) {
    const i = viewColumns(view).findIndex(c => c.slug === t.status);
    if (i >= 0) {
      S.view = view;
      S.col = i;
      S.rows[t.status] = members(t.status).indexOf(slug);
      return;
    }
  }
}

function newTicket(title) {
  title = title.trim();
  if (!title) return;
  const c = currentColumn();
  const status = c && knownSlugs().has(c.slug) ? c.slug : 'inbox';
  const base = slugify(title);
  let slug = base;
  for (let n = 2; S.tickets.has(slug) || fs.existsSync(path.join(TICKETS, `${slug}.md`)); n++) slug = `${base}-${n}`;
  fs.mkdirSync(TICKETS, { recursive: true });
  fs.writeFileSync(path.join(TICKETS, `${slug}.md`), `---\nstatus: ${status}\ncreated: ${today()}\n---\n# ${title}\n`);
  S.tickets = loadTickets();
  place(slug, status, 0);
  writeOrder();
  publish();
  focusSlug(slug);
  S.message = `created ${slug}.md`;
}

// ---------- terminal ----------

const out = process.stdout;
const ESC = '\x1b[';

function fit(text, width) {
  const chars = [...text];
  if (chars.length > width) return chars.slice(0, Math.max(0, width - 1)).join('') + (width > 0 ? '…' : '');
  return text + ' '.repeat(width - chars.length);
}

function wrap(line, width) {
  const chars = [...line];
  if (chars.length <= width) return [line];
  const rows = [];
  let rest = chars;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(' ', width);
    if (cut <= 0) cut = width;
    rows.push(rest.slice(0, cut).join(''));
    rest = rest.slice(rest[cut] === ' ' ? cut + 1 : cut);
  }
  rows.push(rest.join(''));
  return rows;
}

function peekLines(width) {
  const t = S.tickets.get(S.peek.slug);
  const text = fs.readFileSync(t.file, 'utf8').replace(/^---\n[\s\S]*?\n---\n?/, '');
  const body = text.replace(/^#\s+.+\n?/m, '').replace(/^\n+/, '').replace(/\s+$/, '');
  return { t, lines: body ? body.split('\n').flatMap(l => wrap(l, width)) : ['(no description)'] };
}

function renderPeek(W, H) {
  const { t, lines } = peekLines(W - 2);
  const bodyH = Math.max(1, H - 5);
  S.peek.top = clamp(S.peek.top, 0, Math.max(0, lines.length - bodyH));
  const out = [
    `${ESC}1m${fit(` ${t.title}`, W)}${ESC}0m`,
    `${ESC}2m${fit(` ${t.status}${t.created ? `  ·  ${t.created}` : ''}  ·  ${t.slug}.md`, W)}${ESC}0m`,
    '─'.repeat(W),
  ];
  for (let y = 0; y < bodyH; y++) out.push(fit(` ${lines[S.peek.top + y] ?? ''}`, W));
  const more = lines.length > bodyH ? `${S.peek.top + 1}-${Math.min(lines.length, S.peek.top + bodyH)}/${lines.length}  ` : '';
  out.push(`${ESC}2m${fit(`${more}arrows scroll  e edit  enter/esc back`, W)}${ESC}0m`);
  return out;
}

function render() {
  const W = out.columns || 80;
  const H = out.rows || 24;
  if (S.peek) {
    out.write(`${ESC}H` + renderPeek(W, H).slice(0, H).map(l => `${l}${ESC}K`).join('\r\n'));
    return;
  }
  const cols = viewColumns();
  const n = Math.max(1, cols.length);
  const cw = Math.max(4, Math.floor((W - (n - 1)) / n));
  const bodyH = Math.max(1, H - 4);
  const lines = [];

  lines.push(cols.map((c, i) => {
    const label = fit(` ${c.name} ${members(c.slug).length}`, cw);
    return i === S.col ? `${ESC}1;7m${label}${ESC}0m` : `${ESC}1m${label}${ESC}0m`;
  }).join(' '));
  lines.push(cols.map(() => '─'.repeat(cw)).join(' '));

  const colRows = cols.map((c, i) => {
    const m = members(c.slug);
    const row = i === S.col ? currentRow() : Math.min(S.rows[c.slug] || 0, Math.max(0, m.length - 1));
    let top = S.scroll[c.slug] || 0;
    if (row < top) top = row;
    if (row >= top + bodyH) top = row - bodyH + 1;
    top = clamp(top, 0, Math.max(0, m.length - bodyH));
    S.scroll[c.slug] = top;
    return { m, row, top };
  });

  for (let y = 0; y < bodyH; y++) {
    lines.push(cols.map((c, i) => {
      const { m, row, top } = colRows[i];
      const slug = m[top + y];
      if (!slug) return ' '.repeat(cw);
      const text = fit(` ${S.tickets.get(slug).title}`, cw);
      if (S.grab && S.grab.slug === slug) return `${ESC}30;43m${text}${ESC}0m`;
      if (i === S.col && top + y === row) return `${ESC}7m${text}${ESC}0m`;
      return text;
    }).join(' '));
  }

  const t = selected();
  const viewTag = S.view === 'main' ? '' : '[parked] ';
  lines.push(`${ESC}2m${fit(`${viewTag}${t ? `${t.title}  (${t.slug})` : ''}`, W)}${ESC}0m`);
  if (S.prompt !== null) lines.push(fit(`New ticket title: ${S.prompt}`, W));
  else if (S.message) lines.push(fit(S.message, W));
  else lines.push(`${ESC}2m${fit(S.grab
    ? 'arrows carry  space drop  esc cancel  p carry to other view'
    : 'arrows move  space grab  enter view  e edit  n new  p parked  r reload  q quit', W)}${ESC}0m`);

  out.write(`${ESC}H` + lines.slice(0, H).map(l => `${l}${ESC}K`).join('\r\n'));
}

function draw() {
  if (!S.editing && process.stdin.isRaw) render();
}

function enterScreen() {
  out.write(`${ESC}?1049h${ESC}?25l`);
  process.stdin.setRawMode(true);
  process.stdin.resume();
}

function leaveScreen() {
  out.write(`${ESC}?25h${ESC}?1049l`);
  process.stdin.setRawMode(false);
}

function editSelected() {
  const t = selected();
  if (!t) return;
  const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
  S.editing = true;
  leaveScreen();
  process.stdin.pause();
  spawnSync(`${editor} "${t.file}"`, { stdio: 'inherit', shell: true });
  enterScreen();
  S.editing = false;
  const slug = t.slug;
  reload();
  focusSlug(slug);
}

// ---------- sync ----------

function git(...args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', HERE, ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n')[0]));
      else resolve(stdout.trim());
    });
  });
}

// Git operations run one at a time, in order.
let queue = Promise.resolve();
function enqueue(fn) {
  queue = queue.then(fn).catch(e => { S.message = `sync: ${e.message}`; draw(); });
  return queue;
}

let hasOrigin = null;
async function origin() {
  if (hasOrigin === null) hasOrigin = (await git('remote')).split('\n').includes('origin');
  return hasOrigin;
}

async function commitLists() {
  await git('add', '-A', 'lists');
  try {
    await git('diff', '--cached', '--quiet');
    return false;
  } catch {
    await git('commit', '-q', '-m', 'order');
    return true;
  }
}

// Fetch origin's branch and rebase onto it. True when HEAD moved.
async function integrate() {
  if (!(await origin())) return false;
  try {
    await git('fetch', '-q', 'origin', BRANCH);
  } catch {
    return false; // branch not on origin yet; the next push creates it
  }
  const before = await git('rev-parse', 'HEAD');
  try {
    await git('rebase', '-q', '--autostash', `origin/${BRANCH}`);
  } catch {
    await git('rebase', '--abort').catch(() => {});
    throw new Error('order conflicts with origin; resolve in .kanban');
  }
  return (await git('rev-parse', 'HEAD')) !== before;
}

// Called after the board writes lists/: reload if the rebase brought in
// another station's moves.
function absorb(moved) {
  if (!moved) return;
  if (S.grab || S.editing) { S.stale = true; return; }
  const t = selected();
  reload();
  if (t) focusSlug(t.slug);
}

function publish() {
  return enqueue(async () => {
    const committed = await commitLists();
    if (!(await origin())) return;
    const moved = await integrate();
    const ahead = await git('rev-list', '--count', `origin/${BRANCH}..HEAD`).catch(() => '1');
    if (ahead !== '0') await git('push', '-q', '-u', 'origin', BRANCH);
    absorb(moved);
    if (committed) S.message = 'order pushed';
    draw();
  });
}

function poll() {
  if (S.grab || S.editing || S.prompt !== null) return;
  enqueue(async () => {
    const moved = await integrate();
    absorb(moved);
    if (moved && !S.grab) { S.message = 'order synced from origin'; draw(); }
  });
}

async function quit() {
  if (S.grab) cancelGrab();
  leaveScreen();
  process.stdout.write('syncing order… ');
  await publish();
  console.log(S.message.startsWith('sync:') ? S.message : 'done');
  process.exit(0);
}

function tokens(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    const rest = data.slice(i);
    const csi = rest.match(/^\x1b\[[0-9;]*[A-Za-z~]/);
    const ss3 = rest.match(/^\x1bO[A-Za-z]/);
    const m = csi || ss3;
    if (m) { out.push(m[0]); i += m[0].length; }
    else { out.push(rest[0]); i += 1; }
  }
  return out;
}

const KEYS = {
  '\x1b[A': 'up', '\x1bOA': 'up', 'k': 'up',
  '\x1b[B': 'down', '\x1bOB': 'down', 'j': 'down',
  '\x1b[C': 'right', '\x1bOC': 'right', 'l': 'right',
  '\x1b[D': 'left', '\x1bOD': 'left', 'h': 'left',
  '\x1b[5~': 'pgup', '\x1b[6~': 'pgdn',
  '\x1b[H': 'home', '\x1b[1~': 'home', '\x1bOH': 'home', 'g': 'home',
  '\x1b[F': 'end', '\x1b[4~': 'end', '\x1bOF': 'end', 'G': 'end',
  ' ': 'space', '\r': 'enter', '\n': 'enter', '\x1b': 'esc', '\x03': 'quit', 'q': 'quit',
  'n': 'new', 'p': 'parked', 'r': 'reload', 'e': 'edit',
};

function onPromptKey(k) {
  if (k === '\r' || k === '\n') { const title = S.prompt; S.prompt = null; newTicket(title); }
  else if (k === '\x1b' || k === '\x03') S.prompt = null;
  else if (k === '\x7f' || k === '\b') S.prompt = [...S.prompt].slice(0, -1).join('');
  else if (k.length === 1 && k >= ' ') S.prompt += k;
}

function onPeekKey(key, page) {
  const step = { up: -1, down: 1, pgup: -page, pgdn: page, home: -1e9, end: 1e9 }[key];
  if (step) S.peek.top = Math.max(0, S.peek.top + step);
  else if (key === 'enter' || key === 'esc') S.peek = null;
  else if (key === 'edit') { S.peek = null; editSelected(); }
  else if (key === 'quit') quit();
}

function onKey(k) {
  if (S.prompt !== null) return onPromptKey(k);
  S.message = '';
  const key = KEYS[k];
  const page = Math.max(1, (out.rows || 24) - 5);
  if (S.peek) return onPeekKey(key, page);
  const step = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], pgup: [0, -page], pgdn: [0, page], home: [0, -1e9], end: [0, 1e9] }[key];
  if (step) return S.grab ? moveGrabbed(...step) : moveCursor(...step);
  switch (key) {
    case 'space': return grabOrDrop();
    case 'esc': return cancelGrab();
    case 'enter': if (!S.grab && selected()) S.peek = { slug: selected().slug, top: 0 }; return;
    case 'edit': if (!S.grab) editSelected(); return;
    case 'new': if (!S.grab) S.prompt = ''; return;
    case 'parked': return toggleView();
    case 'reload': if (!S.grab) { const t = selected(); reload(); if (t) focusSlug(t.slug); } return;
    case 'quit': return quit();
  }
}

// ---------- print mode ----------

function printBoard(filter) {
  const cols = [...S.columns.main, ...unknownColumns(), ...S.columns.parked]
    .filter(c => !filter.length || filter.includes(c.slug));
  for (const c of cols) {
    const m = members(c.slug);
    console.log(`## ${c.name} (${c.slug}, ${m.length})`);
    for (const s of m) console.log(`- ${S.tickets.get(s).title}  [${s}]`);
    console.log();
  }
}

// ---------- main ----------

reload();
const args = process.argv.slice(2);
if (args[0] === '--print') {
  printBoard(args.slice(1));
} else {
  if (!process.stdin.isTTY) {
    console.error('board: needs a terminal (or use --print [status...])');
    process.exit(1);
  }
  enterScreen();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', data => {
    for (const k of tokens(data)) onKey(k);
    render();
  });
  out.on('resize', draw);
  setInterval(poll, POLL_MS);
  render();
  poll();
}
