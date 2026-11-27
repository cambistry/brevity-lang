#!/usr/bin/env node
// Terminal kanban board over kanban/tickets.
// Status and order live in lists/<status> on the kanban branch, checked out
// as a worktree at .kanban/, one repo-relative ticket path per line.
// Open tickets are in kanban/tickets/; review, done and won't-do ones in
// kanban/finished/; a drop moves the file to its column's folder.
// Each finished move commits and pushes lists/; while open, the board polls
// origin and rebases onto other stations' moves.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TICKETS = path.join(HERE, 'tickets');
const FINISHED = path.join(HERE, 'finished');
const FINISHED_COLUMNS = new Set(['review', 'done', 'wont-do']);
const REPO = path.resolve(HERE, '..');
const WORKTREE = path.join(REPO, '.kanban');
const ORDER_DIR = path.join(WORKTREE, 'lists');
const COLUMNS_FILE = path.join(HERE, 'columns');
const BRANCH = 'kanban';
const POLL_MS = (Number(process.env.KANBAN_POLL) || 15) * 1000;
// Column width aims for MIN_COL..MAX_COL, GAP apart; the cursor scrolls hidden columns into view.
const MIN_COL = 40;
const MAX_COL = 50;
const GAP = '   ';
const ONE_COLUMN_BELOW = 45; // screen width under which a single column shows

// Fewest columns that keep each at MAX_COL or under, but never under MIN_COL;
// two columns hold, narrower, down to ONE_COLUMN_BELOW.
function columnsThatFit(W, total) {
  const g = GAP.length;
  const fitMin = Math.floor((W + g) / (MIN_COL + g));
  const fitMax = Math.ceil((W + g) / (MAX_COL + g));
  const floor = W < ONE_COLUMN_BELOW ? 1 : 2;
  return clamp(Math.max(floor, Math.min(fitMax, fitMin)), 1, Math.max(1, total));
}

// ---------- data ----------

function loadColumns() {
  const columns = [];
  for (const raw of fs.readFileSync(COLUMNS_FILE, 'utf8').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [slug, ...name] = line.split(/\s+/);
    columns.push({ slug, name: name.join(' ') || slug });
  }
  return columns;
}

function folderOf(status) {
  return FINISHED_COLUMNS.has(status) ? FINISHED : TICKETS;
}

function parseTicket(slug, text, dir) {
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
    file: path.join(dir, `${slug}.md`),
    title: heading ? heading[1].trim() : slug,
    status: dir === FINISHED ? 'done' : 'inbox',
    created: fields.created || '',
  };
}

function loadTickets() {
  const tickets = new Map();
  for (const dir of [TICKETS, FINISHED]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const slug = name.slice(0, -3);
      if (tickets.has(slug)) throw new Error(`board: ${slug}.md is in both tickets/ and finished/`);
      tickets.set(slug, parseTicket(slug, fs.readFileSync(path.join(dir, name), 'utf8'), dir));
    }
  }
  return tickets;
}

function ticketPath(slug, status) {
  return path.relative(REPO, path.join(folderOf(status), `${slug}.md`));
}

// A list line names a ticket in either folder, so a list written after a
// move still finds a file the local checkout has yet to move.
function slugOfPath(line) {
  const abs = path.resolve(REPO, line);
  const dir = path.dirname(abs);
  return (dir === TICKETS || dir === FINISHED) && abs.endsWith('.md') ? path.basename(abs, '.md') : null;
}

// Moves the ticket's file to the folder its column keeps.
function fileTicket(ticket, status) {
  const file = path.join(folderOf(status), `${ticket.slug}.md`);
  if (file === ticket.file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.renameSync(ticket.file, file);
  ticket.file = file;
}

// One list per status. The list holding a ticket decides its column and
// position. A ticket in several lists stays in the first. Tickets in no list
// go to the top of done if in finished/, else of inbox, newest first. Sets each ticket's `status` to its
// column, and returns the lists with the unlisted slugs.
function loadLists(tickets) {
  const lists = new Map();
  const files = fs.existsSync(ORDER_DIR) ? fs.readdirSync(ORDER_DIR).filter(f => !f.startsWith('.')).sort() : [];
  const homes = new Map();
  for (const status of files) {
    const slugs = [...new Set(fs.readFileSync(path.join(ORDER_DIR, status), 'utf8').split('\n')
      .map(l => l.trim()).filter(Boolean).map(slugOfPath).filter(s => s && tickets.has(s)))];
    lists.set(status, slugs);
    for (const s of slugs) if (!homes.has(s)) homes.set(s, status);
  }
  for (const [status, list] of lists) lists.set(status, list.filter(s => homes.get(s) === status));
  for (const [s, status] of homes) tickets.get(s).status = status;
  const unlisted = [...tickets.values()].filter(t => !homes.has(t.slug))
    .sort((a, b) => a.created.localeCompare(b.created) || b.slug.localeCompare(a.slug));
  for (const t of unlisted) {
    if (!lists.has(t.status)) lists.set(t.status, []);
    lists.get(t.status).unshift(t.slug);
  }
  return { lists, unlisted: unlisted.map(t => t.slug) };
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
  col: 0,
  rows: {},
  scroll: {},
  left: 0,
  grab: null,
  prompt: null,
  message: '',
  editing: false,
  peek: null,
  split: true,
  confirm: null,
  stale: false,
  quitting: false,
};

// Returns the slugs of tickets no list holds (they sit at the top of their column).
function reload() {
  S.columns = loadColumns();
  S.tickets = loadTickets();
  const { lists, unlisted } = loadLists(S.tickets);
  S.lists = lists;
  return unlisted;
}

function knownSlugs() {
  return new Set(S.columns.map(c => c.slug));
}

function unknownColumns() {
  const known = knownSlugs();
  const extra = [...new Set([...S.tickets.values()].map(t => t.status))].filter(s => !known.has(s)).sort();
  return extra.map(slug => ({ slug, name: `?${slug}` }));
}

// Configured columns, then any status no column names.
function boardColumns() {
  return [...S.columns, ...unknownColumns()];
}

function members(colSlug) {
  return S.lists.get(colSlug) || [];
}

function currentColumn() {
  return boardColumns()[S.col];
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
    fs.writeFileSync(file, list.map(s => `${ticketPath(s, status)}\n`).join(''));
  }
}

// A single up/down step wraps to the other end of the list; paging and jumps stop at the ends.
function stepRow(row, dr, length) {
  if (length <= 0) return 0;
  if (Math.abs(dr) === 1) return (row + dr + length) % length;
  return clamp(row + dr, 0, length - 1);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Left/right lands on the card nearest the same screen line in the next
// column; `skipEmpty` passes over empty columns (the quick-view needs a ticket).
function moveCursor(dc, dr, { skipEmpty = false } = {}) {
  const cols = boardColumns();
  if (dc) {
    let ni = S.col + dc;
    while (skipEmpty && ni >= 0 && ni < cols.length && !members(cols[ni].slug).length) ni += dc;
    if (ni < 0 || ni >= cols.length) { if (skipEmpty) return; ni = clamp(ni, 0, cols.length - 1); }
    if (ni === S.col) return;
    const L = layout();
    const c = currentColumn();
    const y = c && members(c.slug).length ? cardY(c.slug, currentRow(), L) : 0;
    S.col = ni;
    S.rows[cols[ni].slug] = rowAtY(cols[ni].slug, y, L);
  }
  const c = currentColumn();
  if (dr && c) S.rows[c.slug] = stepRow(currentRow(), dr, members(c.slug).length);
}

function moveGrabbed(dc, dr) {
  const g = S.grab;
  const t = S.tickets.get(g.slug);
  const cols = boardColumns();
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
    const ni = stepRow(i, dr, m.length);
    if (ni === i) return;
    place(g.slug, t.status, ni);
  }
  S.rows[t.status] = members(t.status).indexOf(g.slug);
}

function grabOrDrop() {
  if (!S.grab) {
    const t = selected();
    if (!t) return;
    S.grab = { slug: t.slug, lists: copyLists(S.lists), status: t.status };
    return;
  }
  const t = S.tickets.get(S.grab.slug);
  const col = t.status;
  const row = members(col).indexOf(t.slug);
  fileTicket(t, col);
  S.grab = null;
  if (S.stale) {
    // Lists changed on disk during the move: reload them, then re-apply only this move.
    S.stale = false;
    reload();
    S.tickets.get(t.slug).status = col;
    place(t.slug, col, row);
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
  if (S.stale) { S.stale = false; adopt(reload()); }
  focusSlug(t.slug);
}

function focusSlug(slug) {
  const t = S.tickets.get(slug);
  if (!t) return;
  const i = boardColumns().findIndex(c => c.slug === t.status);
  if (i < 0) return;
  S.col = i;
  S.rows[t.status] = members(t.status).indexOf(slug);
}

function newTicket(title) {
  title = title.trim();
  if (!title) return;
  const c = currentColumn();
  const status = c && knownSlugs().has(c.slug) ? c.slug : 'inbox';
  const base = slugify(title);
  let slug = base;
  const taken = s => S.tickets.has(s) || [TICKETS, FINISHED].some(d => fs.existsSync(path.join(d, `${s}.md`)));
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`;
  fs.mkdirSync(folderOf(status), { recursive: true });
  const text = `---\ncreated: ${today()}\n---\n# ${title}\n`;
  fs.writeFileSync(path.join(folderOf(status), `${slug}.md`), text);
  // Only the new ticket: a full loadTickets() would reset every ticket's status to its folder's default.
  S.tickets.set(slug, { ...parseTicket(slug, text, folderOf(status)), status });
  place(slug, status, 0);
  writeOrder();
  publish();
  focusSlug(slug);
  S.message = `created ${slug}.md`;
}

// Removes the ticket file and its list entry; the quick-view moves to the
// card now at the same position, or the column's last, and closes on an empty column.
function deleteTicket(slug) {
  const t = S.tickets.get(slug);
  if (!t) return;
  fs.rmSync(t.file, { force: true });
  S.tickets.delete(slug);
  for (const [status, list] of S.lists) S.lists.set(status, list.filter(s => s !== slug));
  writeOrder();
  publish();
  const next = selected();
  S.peek = S.peek && next ? { slug: next.slug, top: 0 } : null;
  S.message = `deleted ${slug}.md`;
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

function peekLines(slug, width) {
  const t = S.tickets.get(slug);
  const raw = fs.existsSync(t.file) ? fs.readFileSync(t.file, 'utf8') : '';
  const text = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const body = text.replace(/^#\s+.+\n?/m, '').replace(/^\n+/, '').replace(/\s+$/, '');
  return { t, lines: body ? body.split('\n').flatMap(l => wrap(l, width)) : ['(no description)'] };
}

function columnName(slug) {
  const c = boardColumns().find(c => c.slug === slug);
  return c ? c.name : slug;
}

function renderPeek(W, H) {
  const { t, lines } = peekLines(S.peek.slug, W - 2);
  const bodyH = Math.max(1, H - 4);
  S.peek.top = clamp(S.peek.top, 0, Math.max(0, lines.length - bodyH));
  const out = [
    `${ESC}1m${fit(` ${t.title}`, W)}${ESC}0m`,
    `${ESC}2m${fit(` ${columnName(t.status)}${path.dirname(t.file) !== folderOf(t.status) ? `  (file in ${path.basename(path.dirname(t.file))}/)` : ''}${t.created ? `  ·  ${t.created}` : ''}  ·  ${t.slug}.md`, W)}${ESC}0m`,
    '─'.repeat(W),
  ];
  for (let y = 0; y < bodyH; y++) out.push(fit(` ${lines[S.peek.top + y] ?? ''}`, W));
  const more = lines.length > bodyH ? `${S.peek.top + 1}-${Math.min(lines.length, S.peek.top + bodyH)}/${lines.length}  ` : '';
  if (S.confirm) out.push(fit(`Delete ${t.slug}.md? (y/n)`, W));
  else if (S.message) out.push(fit(S.message, W));
  else out.push(`${ESC}2m${fit(`${more}arrows ticket  pgup/pgdn scroll  e edit  d delete  enter/esc back  fn-click to select`, W)}${ESC}0m`);
  return out;
}

// A card is the title on up to two lines: "- " then a two-space indent,
// cut with an ellipsis if it still doesn't fit.
function cardLines(title, width) {
  const rows = wrap(title, width - 2);
  const lines = [fit(`- ${rows[0]}`, width)];
  if (rows.length > 1) lines.push(fit(`  ${rows.slice(1).join(' ')}`, width));
  return lines;
}

// Board geometry for the current terminal size. In split mode the board
// takes the top three quarters (header, rule, cards) and the ticket the rest.
function layout() {
  const W = out.columns || 80;
  const H = out.rows || 24;
  const total = boardColumns().length;
  const fits = columnsThatFit(W, total);
  const n = Math.max(1, Math.min(fits, total));
  const boardH = S.split ? Math.ceil(H * 3 / 4) : H - 2;
  return { W, H, fits, cw: Math.max(6, Math.floor((W - GAP.length * (n - 1)) / n)), bodyH: Math.max(1, boardH - 2) };
}

// Split mode's lower pane: a rule, the selected ticket's title, and as much
// of its body as fits (no scrolling; enter opens the full view).
function splitPane(W, height) {
  const t = selected();
  const lines = ['─'.repeat(W)];
  if (!t) return lines;
  lines.push(`${ESC}1m${fit(` ${t.title}`, W)}${ESC}0m`);
  const body = peekLines(t.slug, W - 2).lines;
  const room = Math.max(0, height - lines.length);
  const shown = body.length > room ? [...body.slice(0, Math.max(0, room - 1)), '…'] : body;
  for (const l of shown.slice(0, room)) lines.push(fit(` ${l}`, W));
  return lines;
}

function cardsOf(colSlug, cw) {
  return members(colSlug).map(slug => cardLines(S.tickets.get(slug).title, cw));
}

function rememberedRow(colSlug) {
  return Math.min(S.rows[colSlug] || 0, Math.max(0, members(colSlug).length - 1));
}

// First card shown in a column: keeps `row` whole on screen, and fills the
// column from the bottom when the rest would fit.
function scrollTop(colSlug, row, { cw, bodyH }) {
  const cards = cardsOf(colSlug, cw);
  const height = (a, b) => cards.slice(a, b + 1).reduce((h, k) => h + k.length, 0);
  let top = clamp(S.scroll[colSlug] || 0, 0, Math.max(0, cards.length - 1));
  if (row < top) top = row;
  while (top < row && height(top, row) > bodyH) top++;
  while (top > 0 && height(top - 1, cards.length - 1) <= bodyH) top--;
  return (S.scroll[colSlug] = top);
}

// Screen line (within the column body) where card `row` starts.
function cardY(colSlug, row, L) {
  const top = scrollTop(colSlug, row, L);
  return cardsOf(colSlug, L.cw).slice(top, row).reduce((h, k) => h + k.length, 0);
}

// The card covering screen line `y` of a column, or the nearest one above it.
function rowAtY(colSlug, y, L) {
  const cards = cardsOf(colSlug, L.cw);
  if (!cards.length) return 0;
  let line = 0;
  for (let k = scrollTop(colSlug, rememberedRow(colSlug), L); k < cards.length; k++) {
    if (y < line + cards[k].length) return k;
    line += cards[k].length;
  }
  return cards.length - 1;
}

// First visible column: scrolls just enough to keep the cursor's column on screen.
function leftColumn(n, v) {
  let l = S.left;
  if (S.col < l) l = S.col;
  if (S.col >= l + v) l = S.col - v + 1;
  return (S.left = clamp(l, 0, n - v));
}

function render() {
  if (S.quitting) return; // never paint over the restored screen
  const W = out.columns || 80;
  const H = out.rows || 24;
  if (S.peek) {
    out.write(`${ESC}H` + renderPeek(W, H).slice(0, H).map(l => `${l}${ESC}K`).join('\r\n') + `${ESC}J`);
    return;
  }
  const all = boardColumns();
  const L = layout();
  const { fits, cw, bodyH } = L;
  const left = leftColumn(all.length, fits);
  const cols = all.slice(left, left + fits);
  const lines = [];

  lines.push(cols.map((c, i) => {
    const n = members(c.slug).length;
    const count = left + i === S.col && n ? `${currentRow() + 1} / ${n}` : `${n}`;
    let label = fit(` ${c.name} ${count}`, cw);
    if (i === 0 && left > 0) label = '‹' + label.slice(1);
    if (i === cols.length - 1 && left + cols.length < all.length) label = label.slice(0, -1) + '›';
    return left + i === S.col ? `${ESC}1;7m${label}${ESC}0m` : `${ESC}1m${label}${ESC}0m`;
  }).join(GAP));
  lines.push(cols.map(() => '─'.repeat(cw)).join(GAP));

  // Per column: display lines from the first card shown, keeping the selected card whole.
  const colLines = cols.map((c, i) => {
    const ci = left + i;
    const m = members(c.slug);
    const cards = cardsOf(c.slug, cw);
    const row = ci === S.col ? currentRow() : rememberedRow(c.slug);
    const top = scrollTop(c.slug, row, L);
    const shown = [];
    for (let k = top; k < m.length && shown.length < bodyH; k++) {
      const style = S.grab && S.grab.slug === m[k] ? `${ESC}30;43m` : ci === S.col && k === row ? `${ESC}7m` : '';
      for (const l of cards[k]) shown.push(style ? `${style}${l}${ESC}0m` : l);
    }
    return shown;
  });

  for (let y = 0; y < bodyH; y++) lines.push(colLines.map(cl => cl[y] ?? ' '.repeat(cw)).join(GAP));

  if (S.split) {
    const pane = splitPane(W, H - lines.length - 1);
    lines.push(...pane, ...Array(Math.max(0, H - lines.length - pane.length - 1)).fill(''));
  } else {
    const t = selected();
    lines.push(`${ESC}2m${fit(t ? `${t.title}  (${t.slug})` : '', W)}${ESC}0m`);
  }
  if (S.prompt !== null) lines.push(fit(`New ticket title: ${S.prompt}`, W));
  else if (S.message) lines.push(fit(S.message, W));
  else lines.push(`${ESC}2m${fit(S.grab
    ? 'arrows carry  space drop  esc cancel'
    : `arrows move  space grab  enter view  f ${S.split ? 'full' : 'split'}  e edit  c copy  n new  r reload  q quit`, W)}${ESC}0m`);

  out.write(`${ESC}H` + lines.slice(0, H).map(l => `${l}${ESC}K`).join('\r\n') + `${ESC}J`);
}

function draw() {
  if (!S.editing && process.stdin.isRaw) render();
}

// Tab title. Apple Terminal ignores the title stack (CSI 22/23 t), so it is
// reset with an empty title on quit; elsewhere the previous title is popped.
const TITLE = `Kanban — ${path.basename(REPO)}`;
const APPLE = process.env.TERM_PROGRAM === 'Apple_Terminal';

// OSC 1 is the tab title in Apple Terminal, OSC 2 the window title; OSC 0 sets both elsewhere.
function setTitle() {
  out.write(`\x1b]0;${TITLE}\x07\x1b]1;${TITLE}\x07\x1b]2;${TITLE}\x07`);
}

function restoreTitle() {
  out.write(APPLE ? '\x1b]1;\x07\x1b]2;\x07' : `${ESC}23;0t`);
}

function enterScreen() {
  // Mouse reporting on (SGR) so wheel/trackpad scrolls arrive as mouse events, which are dropped,
  // instead of arrow keys or scrollback.
  out.write(`${ESC}?1049h${ESC}?25l${ESC}?1000h${ESC}?1006h`);
  setTitle();
  process.stdin.setRawMode(true);
  process.stdin.resume();
}

function leaveScreen() {
  out.write(`${ESC}?1006l${ESC}?1000l${ESC}?25h${ESC}?1049l`);
  process.stdin.setRawMode(false);
}

// The selected ticket's full title to the clipboard.
function copyTitle() {
  const t = selected();
  if (!t) return;
  const r = spawnSync('pbcopy', { input: t.title });
  S.message = r.status === 0 ? 'title copied' : `copy: ${r.error ? r.error.message : `pbcopy exited ${r.status}`}`;
}

function editSelected() {
  const t = selected();
  if (!t) return;
  const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
  const FM = /^---\n[\s\S]*?\n---\n?/;
  const body = fs.readFileSync(t.file, 'utf8').replace(FM, '');
  const tmp = path.join(os.tmpdir(), `kanban-${process.pid}-${t.slug}.md`);
  fs.writeFileSync(tmp, body);
  S.editing = true;
  leaveScreen();
  process.stdin.pause();
  spawnSync(`${editor} "${tmp}"`, { stdio: 'inherit', shell: true });
  const edited = fs.readFileSync(tmp, 'utf8');
  fs.rmSync(tmp, { force: true });
  if (edited !== body) {
    // Re-read: front-matter may have changed on disk while editing.
    let fm = (fs.readFileSync(t.file, 'utf8').match(FM) || [''])[0];
    if (fm && !fm.endsWith('\n')) fm += '\n';
    fs.writeFileSync(t.file, fm + edited);
  }
  enterScreen();
  S.editing = false;
  const slug = t.slug;
  reload();
  focusSlug(slug);
}

// ---------- sync ----------

function git(...args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', WORKTREE, ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
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

// Tickets no list holds go on record at the top of their column.
function adopt(unlisted) {
  if (!unlisted.length) return;
  writeOrder();
  publish();
  S.message = unlisted.length === 1 ? `found ${unlisted[0]}.md` : `found ${unlisted.length} tickets`;
}

// A ticket file added, changed or removed on disk: reload, keeping the cursor
// (and the quick-view, when its ticket still exists).
function refreshTickets() {
  if (S.editing || S.quitting) return; // the editor reloads on return
  if (S.grab) { S.stale = true; return; }
  const t = selected();
  const unlisted = reload();
  if (t) focusSlug(t.slug);
  if (S.peek && !S.tickets.has(S.peek.slug)) {
    const next = selected();
    S.peek = next ? { slug: next.slug, top: 0 } : null;
  }
  if (S.confirm && !S.tickets.has(S.confirm.slug)) S.confirm = null;
  adopt(unlisted);
  draw();
}

let watchTimer = null;
function watchTickets() {
  for (const dir of [TICKETS, FINISHED]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.watch(dir, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(refreshTickets, 150);
    });
  }
}

function poll() {
  if (S.grab || S.editing || S.prompt !== null) return;
  enqueue(async () => {
    const moved = await integrate();
    absorb(moved);
    if (moved && !S.grab) { S.message = 'order synced from origin'; draw(); }
  });
}

// Leaves the terminal as it was: the status line is erased once the sync
// finishes, and only a sync failure is left on screen.
async function quit() {
  if (S.quitting) return;
  S.quitting = true;
  if (S.grab) cancelGrab();
  leaveScreen();
  restoreTitle();
  out.write('syncing order…');
  await publish();
  out.write(`\r${ESC}K`);
  if (S.message.startsWith('sync:')) console.log(S.message);
  process.exit(0);
}

// Any other exit (kill, closed window, crash) restores the screen too.
let restored = false;
function restoreTerminal() {
  if (restored || !process.stdin.isRaw) return;
  restored = true;
  S.quitting = true;
  leaveScreen();
  restoreTitle();
}
for (const sig of ['SIGTERM', 'SIGHUP']) process.on(sig, () => { restoreTerminal(); process.exit(1); });
process.on('uncaughtException', err => { restoreTerminal(); console.error(err); process.exit(1); });
process.on('unhandledRejection', err => { restoreTerminal(); console.error(err); process.exit(1); });

function tokens(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    const rest = data.slice(i);
    const mouse = rest.match(/^\x1b\[<[0-9;]*[Mm]/);
    if (mouse) { i += mouse[0].length; continue; }
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
  'n': 'new', 'r': 'reload', 'e': 'edit', 'd': 'delete', 'c': 'copy', 'f': 'split',
};

function onPromptKey(k) {
  if (k === '\r' || k === '\n') { const title = S.prompt; S.prompt = null; newTicket(title); }
  else if (k === '\x1b' || k === '\x03') S.prompt = null;
  else if (k === '\x7f' || k === '\b') S.prompt = [...S.prompt].slice(0, -1).join('');
  else if (k.length === 1 && k >= ' ') S.prompt += k;
}

function onPeekKey(key, page) {
  const walk = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[key];
  const step = { pgup: -page, pgdn: page, home: -1e9, end: 1e9 }[key];
  if (walk) {
    moveCursor(...walk, { skipEmpty: true });
    const t = selected();
    if (t && t.slug !== S.peek.slug) S.peek = { slug: t.slug, top: 0 };
  } else if (step) S.peek.top = Math.max(0, S.peek.top + step);
  else if (key === 'enter' || key === 'esc') S.peek = null;
  else if (key === 'edit') { S.peek = null; editSelected(); }
  else if (key === 'delete') S.confirm = { slug: S.peek.slug };
  else if (key === 'quit') quit();
}

function onKey(k) {
  if (S.prompt !== null) return onPromptKey(k);
  S.message = '';
  if (S.confirm) {
    const { slug } = S.confirm;
    S.confirm = null;
    if (k === 'y' || k === 'Y') deleteTicket(slug);
    return;
  }
  const key = KEYS[k];
  if (S.peek) return onPeekKey(key, Math.max(1, (out.rows || 24) - 5));
  const page = Math.max(1, layout().bodyH - 1);
  const step = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], pgup: [0, -page], pgdn: [0, page], home: [0, -1e9], end: [0, 1e9] }[key];
  if (step) return S.grab ? moveGrabbed(...step) : moveCursor(...step);
  switch (key) {
    case 'space': return grabOrDrop();
    case 'esc': return cancelGrab();
    case 'enter': if (!S.grab && selected()) S.peek = { slug: selected().slug, top: 0 }; return;
    case 'edit': if (!S.grab) editSelected(); return;
    case 'copy': if (!S.grab) copyTitle(); return;
    case 'split': S.split = !S.split; return;
    case 'new': if (!S.grab) S.prompt = ''; return;
    case 'reload': if (!S.grab) { const t = selected(); reload(); if (t) focusSlug(t.slug); } return;
    case 'quit': return quit();
  }
}

// ---------- print mode ----------

function printBoard(filter) {
  const cols = boardColumns()
    .filter(c => !filter.length || filter.includes(c.slug));
  for (const c of cols) {
    const m = members(c.slug);
    console.log(`## ${c.name} (${c.slug}, ${m.length})`);
    for (const s of m) console.log(`- ${S.tickets.get(s).title}  [${s}]`);
    console.log();
  }
}

// ---------- main ----------

const startUnlisted = reload();
const args = process.argv.slice(2);
if (args[0] === '--print') {
  printBoard(args.slice(1));
} else {
  if (!fs.existsSync(path.join(WORKTREE, '.git'))) {
    console.error('board: no .kanban worktree. Set up with:\n  git fetch origin kanban\n  git worktree add .kanban kanban');
    process.exit(1);
  }
  if (!process.stdin.isTTY) {
    console.error('board: needs a terminal (or use --print [status...])');
    process.exit(1);
  }
  if (!APPLE) out.write(`${ESC}22;0t`); // push the current title
  enterScreen();
  adopt(startUnlisted);
  watchTickets();
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
