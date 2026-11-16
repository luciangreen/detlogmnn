// Detlog MNN hybrid: runs each query on the faster of two exact routes, and on Prolog where
// neither applies.
//
//   C route    pl2detlog's native tier: the same analysis as its Prolog -> Detlog -> C export,
//              compiled to JavaScript (a web page can't compile C). It applies to calls whose
//              inputs are ground and whose outputs are fresh (the type contract); any other call,
//              or any value it can't follow (a big integer, say), bails out to the MNN route.
//   MNN route  the proved Detlog MNN rewrite, run by pl2detlog's JIT: full terms and unification.
//   Prolog     pl2detlog's reference Prolog engine, for the parts the conversion can't keep exact:
//              conversion errors, dynamic predicates and database updates, and anything the
//              round trip back to Prolog reports as changed.
//
// Point 1 (a bound output): a query p(..., Given, ...) whose argument is an output of p is run as
// p(..., V, ...), V = Given: compute, then unify, never search for a value matching Given. That is
// exact only when p is steadfast in that argument (Prolog would do the same with the argument
// bound), which steadfast() proves from the clauses; otherwise the query runs as written.
//
// The first run of a query times both routes, checks they give the same answers, and picks the
// faster; later runs use the pick. With check: true it also runs Prolog and compares.

const D = (P, t) => P.deref(t);

// ---- terms ----
function conjList(P, g) {
  g = D(P, g);
  if (g.t === 'c' && g.f === ',' && g.a.length === 2) return [...conjList(P, g.a[0]), ...conjList(P, g.a[1])];
  return [g];
}
function occurs(P, v, t) {
  t = D(P, t);
  if (t === v) return true;
  return t.t === 'c' && t.a.some((x) => occurs(P, v, x));
}
const keyOf = (P, g) => { g = D(P, g); return g.t === 'c' ? `${g.f}/${g.a.length}` : g.t === 'a' ? `${g.name ?? P.show(g)}/0` : null; };
const isIte = (P, g) => { g = D(P, g); return g.t === 'c' && g.f === ';' && g.a.length === 2 && D(P, g.a[0]).t === 'c' && D(P, g.a[0]).f === '->' && D(P, g.a[0]).a.length === 2; };
const isCut = (P, g) => { g = D(P, g); return g.t === 'a' && P.show(g) === '!'; };

// ---- what a query reaches ----
// Every predicate key in the query and the clauses it can call, found by looking at every
// subterm (so goals inside findall/3, call/N and the like count too).
const DB = /^(assert[az]?|retract(all)?|abolish)\/\d+$/;
export function reaches(P, prog, term) {
  const seen = new Set();
  const todo = [];
  const visit = (t) => {
    t = D(P, t);
    const k = keyOf(P, t);
    if (k && !seen.has(k)) { seen.add(k); if (prog.preds.has(k)) todo.push(k); }
    if (t.t === 'c') t.a.forEach(visit);
  };
  visit(term);
  while (todo.length) for (const cl of prog.preds.get(todo.pop())) visit(cl.body);
  return seen;
}

// ---- point 1: steadfastness ----
// Is output argument i of predicate k steadfast: does running it with that argument bound give
// the same answers as running it with a fresh variable and unifying afterwards? Proved per clause:
// the head argument is a variable V found nowhere else in the head, and the body ends in one of
//   (A) V = T, T = V or V is E, with V nowhere else in the body (and not in T or E);
//   (B) Pre, (C -> T ; E) with V not in Pre or C, and T and E each one of (A)-(D);
//   (C) Pre, q(..., V, ...) with V not in Pre, once in that call, where q is steadfast there;
//   (D) Pre, !, Rest with V not in Pre, and Rest one of (A)-(D).
// In each case V is untouched until its value is computed, so binding it early only adds a final
// unification, which may fail exactly where the later one would. Recursion is assumed steadfast
// while it is being proved (the greatest fixed point); clauses without V's argument fail the check.
export function steadfast(P, prog, k, i, assume = new Set()) {
  const id = `${k}#${i}`;
  if (assume.has(id)) return { ok: true, why: 'recursive call (proved by induction)' };
  const cls = prog.preds.get(k);
  if (!cls || !cls.length) return { ok: false, why: `${k} has no clauses here` };
  if (prog.dynamic?.has?.(k)) return { ok: false, why: `${k} is dynamic` };
  const seen = new Set(assume).add(id);
  const reasons = [];
  for (const [ci, cl] of cls.entries()) {
    const head = D(P, cl.head);
    const V = D(P, head.a[i]);
    if (V.t !== 'v') return { ok: false, why: `clause ${ci + 1} of ${k} has a value in argument ${i + 1}` };
    if (head.a.some((x, j) => j !== i && occurs(P, V, x))) return { ok: false, why: `clause ${ci + 1} of ${k} shares argument ${i + 1} with another argument` };
    const r = bodyOk(P, prog, conjList(P, cl.body), V, seen);
    if (!r.ok) return { ok: false, why: `clause ${ci + 1} of ${k}: ${r.why}` };
    reasons.push(r.why);
  }
  return { ok: true, why: [...new Set(reasons)].join('; ') };
}
function bodyOk(P, prog, goals, V, seen) {
  if (!goals.length) return { ok: false, why: 'the output is never computed' };
  const last = D(P, goals[goals.length - 1]);
  // (D): the last cut at the top level
  const cut = goals.map((g) => isCut(P, g)).lastIndexOf(true);
  if (cut >= 0) {
    if (goals.slice(0, cut).some((g) => occurs(P, V, g))) return { ok: false, why: 'the output is used before the cut' };
    const r = bodyOk(P, prog, goals.slice(cut + 1), V, seen);
    return r.ok ? { ok: true, why: `cut first (D), then ${r.why}` } : r;
  }
  const pre = goals.slice(0, -1);
  if (pre.some((g) => occurs(P, V, g))) return { ok: false, why: 'the output is used before its value is computed' };
  // (A)
  if (last.t === 'c' && last.a.length === 2 && (last.f === '=' || last.f === 'is')) {
    const [l, r] = last.a.map((x) => D(P, x));
    if (l === V && !occurs(P, V, r)) return { ok: true, why: `computed then bound (A: ${last.f})` };
    if (last.f === '=' && r === V && !occurs(P, V, l)) return { ok: true, why: 'computed then bound (A: =)' };
    return { ok: false, why: 'the output is compared, not just bound' };
  }
  // (B)
  if (isIte(P, last)) {
    const [c, t] = D(P, last.a[0]).a; const e = last.a[1];
    if (occurs(P, V, c)) return { ok: false, why: 'the output is used in a condition' };
    const rt = bodyOk(P, prog, conjList(P, t), V, seen); if (!rt.ok) return rt;
    const re = bodyOk(P, prog, conjList(P, e), V, seen); if (!re.ok) return re;
    return { ok: true, why: `committed, then each branch bound (B: ${[...new Set([rt.why, re.why])].join(', ')})` };
  }
  // (C)
  const k = keyOf(P, last);
  if (k && prog.preds.has(k)) {
    const at = last.a.map((x) => D(P, x)).reduce((acc, x, j) => (x === V ? [...acc, j] : occurs(P, V, x) ? [...acc, -1] : acc), []);
    if (at.length !== 1 || at[0] < 0) return { ok: false, why: `the output is passed to ${k} other than as one whole argument` };
    const r = steadfast(P, prog, k, at[0], seen);
    return r.ok ? { ok: true, why: `passed on (C: ${k} argument ${at[0] + 1})` } : { ok: false, why: r.why };
  }
  return { ok: false, why: k ? `the last goal ${k} is not a program predicate` : 'the last goal is not a call' };
}

// The query with point 1 applied: each ground argument of a single call that is a steadfast output
// becomes a fresh variable unified afterwards. Returns { text, outputs: [{ arg, why }] }.
export function pointOne(P, prog, queryText) {
  const q = P.readTerm(queryText);
  const g = D(P, q.term);
  const k = keyOf(P, g);
  if (!k || g.t !== 'c' || !prog.preds.has(k)) return { text: queryText, outputs: [] };
  const args = g.a.map((x) => D(P, x));
  const outputs = [];
  const parts = [];
  const nm = P.namer();
  const shown = args.map((x) => P.show(x, { quoted: true, varName: (v) => q.vars.find(([, w]) => D(P, w) === v)?.[0] ?? nm(v) }));
  args.forEach((x, i) => {
    if (x.t === 'v' || !P.isGround(x)) return;
    const s = steadfast(P, prog, k, i);
    if (!s.ok) return;
    outputs.push({ arg: i + 1, why: s.why });
    parts.push(`_O${i + 1} = ${shown[i]}`);
    shown[i] = `_O${i + 1}`;
  });
  if (!outputs.length) return { text: queryText, outputs };
  return { text: `${P.show(P.Atom(g.f), { quoted: true })}(${shown.join(', ')}), ${parts.join(', ')}`, outputs };
}

// ---- time/1 ----
// time(Goal) in a query runs Goal on the hybrid and reports like SWI-Prolog; in a program running
// on the Prolog route it is a builtin that reports to the output.
export function installTime(P) {
  if (P.builtins['time/1']) return;
  const B = P.builtins;
  B['$time_start/1'] = { fn: (a, e) => e.unify(a[0], P.Cmp('t', [P.Num(P.now(), true), P.Int(e.steps)])) };
  B['$time_report/1'] = {
    fn: (a, e) => {
      const t = D(P, a[0]);
      const ms = P.now() - D(P, t.a[0]).v, n = e.steps - D(P, t.a[1]).v;
      e.write(timeLine(n, ms, 'Prolog'));
      return true;
    }
  };
  // time(G) :- '$time_start'(T), ( call(G) *-> '$time_report'(T) ; '$time_report'(T), fail ).
  B['time/1'] = {
    call: true,
    fn: (a) => {
      const T = P.Var('T');
      const report = P.Cmp('$time_report', [T]);
      return P.Cmp(',', [P.Cmp('$time_start', [T]), P.Cmp(';', [P.Cmp('*->', [P.Cmp('call', [a[0]]), report]), P.Cmp(',', [report, P.Atom('fail')])])]);
    }
  };
}
export function timeLine(steps, ms, route) {
  const s = ms / 1000;
  const lips = s > 0 ? Math.round(steps / s) : 'Infinite';
  return `% ${steps.toLocaleString('en')} inferences, ${s.toFixed(3)} CPU in ${s.toFixed(3)} seconds (100% CPU, ${typeof lips === 'number' ? lips.toLocaleString('en') : lips} Lips) [${route}]\n`;
}

// ---- consult ----
// `:- consult(F).`, `:- [F, G].` and `:- include(F).` are replaced by the files' text, read with
// readFile(name) (from the device's files); each file is read once.
export async function expandConsults(text, readFile, seen = new Set()) {
  const re = /^:-\s*(?:consult\(\s*([^)]*?)\s*\)|include\(\s*([^)]*?)\s*\)|\[\s*([^\]]*?)\s*\])\s*\.\s*$/gm;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += text.slice(last, m.index);
    last = m.index + m[0].length;
    const names = (m[1] ?? m[2] ?? m[3]).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    for (const n0 of names) {
      const n = /\.\w+$/.test(n0) ? n0 : `${n0}.pl`;
      if (seen.has(n)) { out += `% ${n} already consulted\n`; continue; }
      seen.add(n);
      const body = await readFile(n);
      if (body == null) throw new Error(`can't find ${n} to consult`);
      out += `% ---- ${n} ----\n${await expandConsults(body, readFile, seen)}\n% ---- end of ${n} ----\n`;
    }
  }
  return out + text.slice(last);
}

// ---- the session ----
const sameAnswers = (a, b) => JSON.stringify(a.events ?? a.answers) === JSON.stringify(b.events ?? b.answers);
function time(P, f, minMs = 20, maxReps = 50) {
  let reps = 0; const t0 = P.now(); let r;
  do { r = f(); reps++; } while (P.now() - t0 < minMs && reps < maxReps);
  return { r, ms: (P.now() - t0) / reps };
}

// A step limit that is also a time limit: the engines compare their step count with it on every
// step, and every 4096th comparison looks at the clock. (Some queries are slow per step: append/3
// on partial lists builds ever longer lists.)
function limit(P, steps, ms) {
  let n = 0, timedOut = false;
  const deadline = P.now() + ms;
  return {
    valueOf() { if ((++n & 4095) === 0 && P.now() > deadline) timedOut = true; return timedOut ? -1 : steps; },
    toString() { return timedOut ? `time limit ${ms / 1000} s` : String(steps); }
  };
}
const tidy = (e) => (e ? String(e).replace(/^step limit \(time limit ([\d.]+ s)\) exceeded$/, 'time limit ($1) exceeded') : e);

export class Hybrid {
  // checked: the C route tests its type contract at run time (pl2detlog's P.DETLOG_CHECKED); unchecked,
  // the default, it tests nothing, and a query outside the contract is caught when the C and MNN routes
  // disagree on its first run (Prolog then decides), or by Check against Prolog
  constructor(P, { stepLimit = 3e6, timeLimitMs = 10000, maxAnswers = 1000, checked = false } = {}) {
    this.P = P; this.stepLimit = stepLimit; this.timeLimitMs = timeLimitMs; this.maxAnswers = maxAnswers; this.checked = checked;
    installTime(P);
    this.setProgram('');
  }

  setProgram(src) {
    this.src = src;
    this.prog = this.P.loadProgram(src);
    this.plans = new Map();
  }

  // The plan for a query: which routes apply and why.
  plan(queryText) {
    const P = this.P;
    queryText = queryText.trim().replace(/\.\s*$/, '');
    if (this.plans.has(queryText)) return this.plans.get(queryText);
    const plan = { query: queryText, routes: [], notes: [] };
    const p1 = pointOne(P, this.prog, queryText);
    plan.runAs = p1.text; plan.pointOne = p1.outputs;
    let reached = new Set();
    try { reached = reaches(P, this.prog, P.readTerm(p1.text).term); } catch (e) { plan.notes.push(e.message); }
    const dynamic = [...reached].some((k) => DB.test(k) || this.prog.dynamic.has(k));
    let conv;
    try { conv = P.convert(this.src, { mnn: true, s2a: false, queries: [p1.text] }); } catch (e) { plan.notes.push(`conversion: ${e.message}`); }
    const q = conv?.queries?.[0];
    if (!conv || conv.errors.length || !q || q.error) {
      if (conv) plan.notes.push(...conv.errors.map(String)); if (q?.error) plan.notes.push(q.error);
      plan.route = 'Prolog'; plan.why = 'the conversion has errors';
    } else if (dynamic) {
      plan.route = 'Prolog'; plan.why = 'the program changes its own clauses (assert/retract), which the conversion can\'t keep exact';
    } else {
      let changes = [];
      try {
        const back = P.backConvert(conv.text);
        const all = P.changeWarnings(this.src, back.text, back).filter((w) => reached.has(w.pred));
        // 'changed' entries are pl2detlog's proved rewrites (once/1 as if-then-else and so on): listed,
        // not blocking; a predicate that is missing or not back-convertible sends the query to Prolog
        plan.rewrites = all.filter((w) => w.kind === 'changed').map((w) => `${w.pred}: ${w.msg}`);
        changes = all.filter((w) => w.kind === 'removed' || w.kind === 'error' || w.kind === 'added' && reached.has(w.pred));
      } catch (e) { changes = [`back-conversion: ${e.message}`]; }
      if (changes.length) {
        plan.route = 'Prolog'; plan.why = 'the round trip back to Prolog reports a change'; plan.notes.push(...changes.map((c) => c.msg ?? String(c)));
      } else {
        plan.conv = conv; plan.q = q; plan.detlog = P.loadProgram(conv.text);
        plan.warnings = conv.warnings.filter((w) => !w.pred || reached.has(w.pred)).map((w) => `${w.pred ?? ''} ${w.msg}`.trim());
      }
    }
    this.plans.set(queryText, plan);
    return plan;
  }

  runProlog(text) {
    const P = this.P;
    const prog = this.prog.dynamic.size || /\b(assert[az]?|retract(all)?|abolish)\s*\(/.test(this.src) ? P.loadProgram(this.src) : this.prog;
    const r = P.runQuery(prog, text, { stepLimit: limit(P, this.stepLimit, this.timeLimitMs), maxAnswers: this.maxAnswers });
    r.error = tidy(r.error);
    return r;
  }
  setChecked(on) { this.checked = !!on; this.plans = new Map(); }
  runDetlog(plan, native) {
    const P = this.P;
    const was = P.DETLOG_NATIVE;
    P.DETLOG_NATIVE = native;
    P.DETLOG_CHECKED = this.checked; // read when the plan's program is compiled
    try { const r = P.runDetlogFast(plan.detlog, plan.q.pred, plan.q.vars, { stepLimit: limit(P, this.stepLimit, this.timeLimitMs) }); r.error = tidy(r.error); return r; } finally { P.DETLOG_NATIVE = was; }
  }

  // Runs a query. time(G) reports like SWI-Prolog. Returns
  // { answers, output, error, route, ms, steps, plan, timeLine?, check? }.
  run(queryText, { check = false } = {}) {
    const P = this.P;
    let text = queryText.trim().replace(/\.\s*$/, '');
    let timed = false;
    const tm = /^time\(\s*([\s\S]*)\)$/.exec(text);
    if (tm && P.readTerm(text)) { timed = true; text = tm[1]; }
    const plan = this.plan(text);
    let res, route, why;
    if (plan.route === 'Prolog') {
      res = this.runProlog(text); route = 'Prolog';
    } else if (!plan.pick) {
      // first run: both routes, timed; they must agree
      const c = time(P, () => this.runDetlog(plan, true));
      // a query that reaches the limit on one converted route reaches it on the other: skip it
      const m = /limit/.test(c.r.error ?? '') ? c : time(P, () => this.runDetlog(plan, false));
      const nativeUsed = P.nativeModesOf(plan.detlog).length > 0;
      plan.timing = { c: c.ms, mnn: m.ms, nativeUsed };
      // Prolog too: the determinism rewrites are dropped where plain Prolog is faster
      const p = /limit/.test(m.r.error ?? '') ? null : time(P, () => this.runProlog(text));
      plan.timing.prolog = p ? p.ms : null;
      if (c.r.error && !m.r.error) { plan.pick = 'MNN'; plan.why = `the C route raised ${c.r.error}`; }
      else if (!sameAnswers(c.r, m.r)) { plan.route = 'Prolog'; plan.why = 'the C and MNN routes disagreed (unchecked, the C route may leave its type contract), so Prolog decides'; res = this.runProlog(text); route = 'Prolog'; }
      else if (!nativeUsed) { plan.pick = 'MNN'; plan.why = 'no call here meets the C route\'s type contract (ground inputs, fresh outputs)'; }
      else { plan.pick = c.ms <= m.ms ? 'C' : 'MNN'; plan.why = `faster on this query (C ${c.ms.toFixed(3)} ms, MNN ${m.ms.toFixed(3)} ms)`; }
      if (!res && p && !p.r.error && !m.r.error && sameAnswers(p.r, m.r) && p.ms < Math.min(c.ms, m.ms)) {
        plan.pick = 'Prolog'; plan.why = `plain Prolog is faster on this query (Prolog ${p.ms.toFixed(3)} ms, C ${c.ms.toFixed(3)} ms, MNN ${m.ms.toFixed(3)} ms)`;
      }
      if (!res) { res = plan.pick === 'C' ? c.r : plan.pick === 'Prolog' ? p.r : m.r; route = plan.pick; }
    } else if (plan.pick === 'Prolog') {
      res = this.runProlog(text); route = 'Prolog';
    } else {
      res = this.runDetlog(plan, plan.pick === 'C'); route = plan.pick;
    }
    if (res.error && route !== 'Prolog') {
      // An error on a converted route is checked against Prolog, which decides. A converted route
      // works out every answer before giving any, so a query with endless answers (len(L, 1))
      // reaches its step limit there; Prolog gives the answers it finds before its own limit.
      const pr = this.runProlog(text);
      if (!sameAnswers(pr, res) || pr.error !== res.error) {
        res = pr; route = 'Prolog';
        why = /limit/i.test(res.error ?? '') || /limit/i.test(pr.error ?? '') ? 'the converted route reached its step limit: Prolog gives the answers it finds' : 'an error on the converted route: Prolog decides errors';
      }
    }
    const out = { answers: res.answers.map((a) => a.text), output: res.output ?? '', error: res.error ?? null, route, why: why ?? plan.why, ms: res.timeMs, steps: res.steps, plan };
    if (timed) out.timeLine = timeLine(res.steps ?? 0, res.timeMs ?? 0, route);
    if (check) {
      const pr = this.runProlog(text);
      out.check = { prolog: pr.answers.map((a) => a.text), prologError: pr.error ?? null, same: sameAnswers(pr, res) && (pr.error ?? null) === (res.error ?? null) };
      // Prolog stopping at its step limit isn't a disagreement: it didn't finish
      if (!out.check.same && pr.limit && !res.error) out.check = { ...out.check, same: null, prologStopped: true };
    }
    return out;
  }

  // pl2detlog's full analysis and proof checks for the queries (the Prove view).
  prove(queries) {
    const r = this.P.analyse(this.src, queries, { timing: false });
    return {
      errors: r.errors,
      checks: r.proof?.checks?.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail ?? c.msg ?? '' })) ?? [],
      runs: (r.runs ?? []).map((x) => ({ query: x.query, same: x.same, prolog: x.prolog?.answers?.map((a) => a.text), mnn: x.mnn?.answers?.map((a) => a.text) })),
      changes: [...(r.changes ?? []), ...(r.changesMnn ?? [])].map((c) => c.msg ?? String(c)),
      detlog: r.mnn?.text ?? ''
    };
  }
}
