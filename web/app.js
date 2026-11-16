// Detlog MNN: the app. A Prolog editor, a query runner on the hybrid (C route, MNN route,
// Prolog), the plan and proofs for each query, and files on the device.
import { Hybrid, expandConsults } from './lib/hybrid.js';
import { basename, canPickFolder, dirname, exportFile, importFiles, join, openFiles, pickFolder, reopenFolder } from './lib/files.js';

const P = globalThis.PL2D;
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null)); return n; };
const APP = 'Detlog MNN';

const EXAMPLE = `% Detlog MNN: Prolog, run on the faster of the C route and the Detlog MNN route.
% Try the queries below, or write your own. time/1 reports how long a query took.

% the first even number in a list, or none
label(L, R) :- ( member(X, L), X mod 2 =:= 0 -> R = even(X) ; R = none ).

fib(0, 0).
fib(1, 1).
fib(N, F) :- N > 1, A is N - 1, B is N - 2, fib(A, FA), fib(B, FB), F is FA + FB.

nrev([], []).
nrev([H|T], R) :- nrev(T, RT), append(RT, [H], R).

max_of(X, Y, X) :- X >= Y, !.
max_of(_, Y, Y).
`;
const QUERIES = ['label([1,3,4,6], R)', 'label([2,3], even(3))', 'time(fib(22, F))', 'nrev([a,b,c,d], R)', 'max_of(5, 3, 3)'];

const state = {
  files: null,
  folder: '',
  path: localStorage.getItem('dm.path') || '',
  dirty: false,
  hybrid: new Hybrid(P),
  history: JSON.parse(localStorage.getItem('dm.history') || '[]'),
  check: localStorage.getItem('dm.check') !== '0'
};

// ---------------- layout ----------------
function setTab(name) {
  document.body.dataset.tab = name;
  for (const b of document.querySelectorAll('nav.tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  if (name === 'files') showFolder(state.folder);
}
for (const b of document.querySelectorAll('nav.tabs button')) b.onclick = () => setTab(b.dataset.tab);

const editor = $('#program');
editor.value = localStorage.getItem('dm.draft') ?? EXAMPLE;
editor.addEventListener('input', () => { state.dirty = true; localStorage.setItem('dm.draft', editor.value); showName(); });
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { e.preventDefault(); editor.setRangeText('    ', editor.selectionStart, editor.selectionEnd, 'end'); }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
});
function showName() { $('#filename').textContent = (state.path ? basename(state.path) : 'Unsaved program') + (state.dirty ? ' •' : ''); }

// ---------------- running ----------------
const query = $('#query');
query.value = state.history[0] ?? QUERIES[0];
query.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); run(); }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const i = state.history.indexOf(query.value) + (e.key === 'ArrowUp' ? 1 : -1);
    if (state.history[i]) { e.preventDefault(); query.value = state.history[i]; }
  }
});
$('#check').checked = state.check;
$('#check').onchange = (e) => { state.check = e.target.checked; localStorage.setItem('dm.check', state.check ? '1' : '0'); };
$('#run').onclick = () => run();
$('#prove').onclick = () => prove();
for (const q of QUERIES) $('#examples').append(el('button', { className: 'chip', textContent: q, onclick: () => { query.value = q; run(); } }));

async function program() {
  const read = async (n) => {
    const at = state.path ? join(dirname(state.path), n) : n;
    for (const p of [at, n]) { try { return await state.files.read(p); } catch { /* next */ } }
    return null;
  };
  return expandConsults(editor.value, read);
}

async function run() {
  const text = query.value.trim();
  if (!text) return;
  state.history = [text, ...state.history.filter((h) => h !== text)].slice(0, 50);
  localStorage.setItem('dm.history', JSON.stringify(state.history));
  const out = $('#results');
  let src;
  try {
    src = await program();
    if (src !== state.hybrid.src) state.hybrid.setProgram(src);
  } catch (e) {
    out.prepend(card(text, { error: `Program: ${e.message}` }));
    return;
  }
  let r;
  try { r = state.hybrid.run(text, { check: state.check }); } catch (e) { r = { error: e.message, answers: [], route: 'Prolog', plan: {} }; }
  out.prepend(card(text, r));
  showPlan(r.plan, r);
  if (document.body.dataset.tab === 'program' && matchMedia('(max-width: 899px)').matches) setTab('run');
}

function card(text, r) {
  const c = el('article', { className: 'result' });
  c.append(el('header', {}, el('code', { textContent: `?- ${text}.` }), r.route ? el('span', { className: `route ${String(r.route).toLowerCase()}`, textContent: r.route, title: r.why ?? '' }) : null));
  if (r.output) c.append(el('pre', { className: 'output', textContent: r.output }));
  if (r.timeLine) c.append(el('pre', { className: 'output time', textContent: r.timeLine }));
  if (r.error) c.append(el('p', { className: 'error', textContent: r.error }));
  else if (!r.answers?.length) c.append(el('p', { className: 'false', textContent: 'false.' }));
  else c.append(el('ul', { className: 'answers' }, ...r.answers.map((a) => el('li', { textContent: `${a}${a === 'true' ? '' : ''}` }))));
  const facts = [];
  if (r.why) facts.push(r.why);
  if (r.plan?.pointOne?.length) facts.push(`run as ${r.plan.runAs}: compute, then unify (argument ${r.plan.pointOne.map((o) => o.arg).join(', ')} is steadfast)`);
  if (typeof r.ms === 'number') facts.push(`${r.ms.toFixed(3)} ms, ${r.steps ?? 0} steps`);
  if (r.check) facts.push(r.check.prologStopped ? 'Prolog reached its step limit before finishing, so it can\'t check this' : r.check.same ? '✓ same answers as Prolog' : `✗ Prolog gives ${r.check.prologError ?? (r.check.prolog.join('; ') || 'false')}`);
  c.append(el('p', { className: 'facts', textContent: facts.join(' · ') }));
  if (r.check && r.check.same === false) c.classList.add('differs');
  return c;
}

function showPlan(plan, r) {
  const p = $('#plan');
  p.replaceChildren();
  if (!plan?.query) { p.append(el('p', { className: 'quiet', textContent: 'Run a query to see how it runs.' })); return; }
  const row = (k, v) => v ? el('div', { className: 'row' }, el('dt', { textContent: k }), el('dd', {}, v)) : null;
  const t = plan.timing;
  p.append(el('h3', { textContent: `?- ${plan.query}.` }), el('dl', {},
    row('Route', `${r.route}${r.why ? ` — ${r.why}` : ''}`),
    row('Run as', plan.runAs !== plan.query ? plan.runAs : null),
    ...(plan.pointOne ?? []).map((o) => row(`Point 1, argument ${o.arg}`, `steadfast: ${o.why}`)),
    row('Times', t ? `C route ${t.c.toFixed(3)} ms · MNN route ${t.mnn.toFixed(3)} ms${t.nativeUsed ? '' : ' (no call met the C contract, so both ran as MNN)'}` : null),
    row('Rewrites', plan.rewrites?.length ? el('ul', {}, ...plan.rewrites.map((w) => el('li', { textContent: w }))) : null),
    row('Warnings', plan.warnings?.length ? el('ul', {}, ...plan.warnings.map((w) => el('li', { textContent: w }))) : null),
    row('Notes', plan.notes?.length ? el('ul', {}, ...plan.notes.map((w) => el('li', { textContent: w }))) : null)));
  if (plan.conv) p.append(el('details', {}, el('summary', { textContent: 'The Detlog MNN program' }), el('pre', { className: 'code', textContent: plan.conv.text })));
}

async function prove() {
  const box = $('#proof');
  box.replaceChildren(el('p', { className: 'quiet', textContent: 'Proving…' }));
  setTab('plan');
  await new Promise((r) => setTimeout(r, 20));
  try {
    const src = await program();
    state.hybrid.setProgram(src);
    const qs = [...new Set([query.value, ...state.history.slice(0, 5)])].map((q) => q.replace(/^time\(([\s\S]*)\)\s*\.?$/, '$1'));
    const r = state.hybrid.prove(qs);
    box.replaceChildren(
      el('h3', { textContent: 'Proof checks' }),
      r.errors.length ? el('p', { className: 'error', textContent: r.errors.join('; ') }) : null,
      el('ul', { className: 'checks' }, ...r.checks.map((c) => el('li', { className: c.ok === false ? 'bad' : 'good', textContent: `${c.ok === false ? '✗' : '✓'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}` }))),
      el('h3', { textContent: 'Prolog, Detlog and the round trip' }),
      el('ul', { className: 'checks' }, ...r.runs.map((x) => el('li', { className: x.same ? 'good' : 'bad', textContent: `${x.same ? '✓' : '✗'} ${x.query}: ${(x.prolog ?? []).join('; ') || 'false'}` }))),
      r.changes.length ? el('details', {}, el('summary', { textContent: 'Round trip back to Prolog' }), el('ul', {}, ...r.changes.map((c) => el('li', { textContent: c })))) : null);
  } catch (e) {
    box.replaceChildren(el('p', { className: 'error', textContent: e.message }));
  }
}

// ---------------- files ----------------
async function startFiles() {
  state.files = await openFiles(APP);
  showWhere();
  try {
    if (!(await state.files.exists('examples/label.pl')) && !(await state.files.exists('examples'))) {
      await state.files.mkdir('examples');
      await state.files.write('examples/label.pl', EXAMPLE);
    }
  } catch { /* read-only */ }
  if (state.path && localStorage.getItem('dm.draft') == null) {
    try { editor.value = await state.files.read(state.path); } catch { state.path = ''; }
  }
  showName();
  showFolder(state.folder);
}
async function showWhere() {
  const w = $('#where');
  w.replaceChildren(el('span', { textContent: `Files: ${state.files.kind === 'opfs' ? 'stored in this browser on this device' : await state.files.root()}` }));
  if (canPickFolder()) {
    w.append(el('button', { textContent: state.files.kind === 'folder' ? 'Choose another folder' : 'Use a folder on this computer', onclick: async () => { try { state.files = await pickFolder(APP); showWhere(); showFolder(''); } catch { /* cancelled */ } } }));
    if (state.files.kind !== 'folder' && localStorage.getItem('dm.hadFolder')) w.append(el('button', { textContent: 'Reopen my folder', onclick: async () => { const f = await reopenFolder(APP); if (f) { state.files = f; showWhere(); showFolder(''); } } }));
    if (state.files.kind === 'folder') localStorage.setItem('dm.hadFolder', '1');
  }
}
async function showFolder(folder) {
  state.folder = folder;
  const list = $('#filelist');
  const crumbs = $('#crumbs');
  crumbs.replaceChildren(el('button', { textContent: 'Home', onclick: () => showFolder('') }), ...folder.split('/').filter(Boolean).map((n, i, a) => el('button', { textContent: n, onclick: () => showFolder(a.slice(0, i + 1).join('/')) })));
  let entries;
  try { entries = await state.files.list(folder); } catch (e) { list.replaceChildren(el('li', { className: 'error', textContent: e.message })); return; }
  list.replaceChildren(...entries.map((e) => {
    const p = join(folder, e.name);
    return el('li', {},
      el('button', { className: 'open', textContent: `${e.type === 'dir' ? '📁' : /\.(pl|pro|txt)$/i.test(e.name) ? '📜' : '📄'} ${e.name}`, onclick: () => (e.type === 'dir' ? showFolder(p) : openFile(p)) }),
      e.type === 'file' ? el('button', { textContent: 'Export', onclick: () => exportFile(state.files, p, 'text/plain') }) : null,
      el('button', { textContent: 'Rename', onclick: async () => { const n = prompt('New name', e.name); if (n && n !== e.name) { await state.files.rename(p, join(folder, n)); if (state.path === p) { state.path = join(folder, n); showName(); } showFolder(folder); } } }),
      el('button', { textContent: 'Delete', className: 'danger', onclick: async () => { if (confirm(`Delete ${e.name}?`)) { await state.files.remove(p); showFolder(folder); } } }));
  }));
  if (!entries.length) list.append(el('li', { className: 'quiet', textContent: 'This folder is empty' }));
}
async function openFile(p) {
  if (state.dirty && !confirm('Discard the changes to the program open now?')) return;
  try {
    editor.value = await state.files.read(p);
    state.path = p; state.dirty = false;
    localStorage.setItem('dm.path', p); localStorage.setItem('dm.draft', editor.value);
    showName(); setTab('program');
  } catch (e) { alert(e.message); }
}
async function save(as = false) {
  let p = state.path;
  if (!p || as) {
    const n = prompt('Save as', p ? basename(p) : 'program.pl');
    if (!n) return;
    p = join(state.folder, n.includes('.') ? n : `${n}.pl`);
  }
  try {
    await state.files.write(p, editor.value);
    state.path = p; state.dirty = false;
    localStorage.setItem('dm.path', p);
    showName();
    if (document.body.dataset.tab === 'files') showFolder(state.folder);
  } catch (e) { alert(`Couldn't save: ${e.message}`); }
}
$('#save').onclick = () => save();
$('#saveas').onclick = () => save(true);
$('#new').onclick = () => { if (state.dirty && !confirm('Discard the changes to the program open now?')) return; editor.value = ''; state.path = ''; state.dirty = false; localStorage.removeItem('dm.path'); showName(); };
$('#newfolder').onclick = async () => { const n = prompt('New folder name'); if (n) { await state.files.mkdir(join(state.folder, n)); showFolder(state.folder); } };
$('#import').onclick = async () => { await importFiles(state.files, state.folder); showFolder(state.folder); };

// ---------------- start ----------------
showName();
showPlan(null);
setTab(matchMedia('(max-width: 899px)').matches ? 'program' : 'run');
startFiles().catch((e) => { $('#where').textContent = `Files unavailable: ${e.message}`; });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
