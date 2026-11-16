// The functions behind the 200 inputs and outputs: the hybrid on real programs and queries
// (answers, the route's plan, point 1, and agreement with Prolog), steadfastness, consult, the
// time/1 line and the device-file interface. Which of the C and MNN routes is faster depends on
// the machine, so the outputs record whether the C route applies, not which one won.
import { P } from '../test/load.mjs';
import { Hybrid, expandConsults, pointOne, steadfast, timeLine } from '../web/lib/hybrid.js';
import { MemoryFiles } from '../web/lib/files.js';

export const title = 'Detlog MNN';

export const PROGRAMS = {
  label: 'label(L, R) :- ( member(X, L), X mod 2 =:= 0 -> R = even(X) ; R = none ).',
  first_label: 'label(L, R) :- ( member(X, L), X mod 2 =:= 0 -> R = even(X) ; R = none ).\nfirst(L, R) :- label(L, R).',
  max_of: 'max_of(X, Y, X) :- X >= Y, !.\nmax_of(_, Y, Y).',
  max_safe: 'max_safe(X, Y, Z) :- ( X >= Y -> Z = X ; Z = Y ).',
  fib: 'fib(0, 0).\nfib(1, 1).\nfib(N, F) :- N > 1, A is N - 1, B is N - 2, fib(A, FA), fib(B, FB), F is FA + FB.',
  fact: 'fact(N, F) :- ( N =:= 0 -> F = 1 ; M is N - 1, fact(M, G), F is N * G ).',
  nrev: 'nrev([], []).\nnrev([H|T], R) :- nrev(T, RT), append(RT, [H], R).',
  sum: 'sum([], 0).\nsum([H|T], S) :- sum(T, S0), S is S0 + H.',
  len: 'len([], 0).\nlen([_|T], N) :- len(T, M), N is M + 1.',
  evens: 'evens([], []).\nevens([H|T], R) :- ( H mod 2 =:= 0 -> R = [H|R1] ; R = R1 ), evens(T, R1).',
  grade: 'grade(N, G) :- ( N >= 80 -> G = a ; N >= 60 -> G = b ; G = c ).',
  pick: 'pick(X, L) :- member(X, L), X > 2.',
  squares: 'squares(N, L) :- findall(Y, (between(1, N, X), Y is X * X), L).',
  counter: ':- dynamic seen/1.\nnote(X) :- assertz(seen(X)).\nnoted(L) :- findall(X, seen(X), L).',
  greet: 'greet(N) :- format("hello ~w~n", [N]).',
  timed: 'slow(N) :- numlist(1, N, L), sum_list(L, _).\nrun(N) :- time(slow(N)).'
};

const lists = (r, lo = 0, hi = 6, a = -9, b = 20) => `[${Array.from({ length: r.int(lo, hi) }, () => r.int(a, b)).join(',')}]`;
const QUERIES = {
  label: (r) => r.pick([`label(${lists(r)}, R)`, `label(${lists(r, 1, 4)}, even(${r.int(-4, 8)}))`, `label(${lists(r, 0, 3, 1, 9)}, none)`, 'label(L, R)', `label([a, ${r.int(1, 4)}], R)`, `label([${r.int(1, 9)}|T], R)`]),
  first_label: (r) => r.pick([`first(${lists(r)}, R)`, `first(${lists(r, 1, 4)}, even(${r.int(0, 8)}))`]),
  max_of: (r) => r.pick([`max_of(${r.int(-5, 9)}, ${r.int(-5, 9)}, M)`, `max_of(${r.int(4, 9)}, ${r.int(0, 3)}, ${r.int(0, 3)})`]),
  max_safe: (r) => r.pick([`max_safe(${r.int(-5, 9)}, ${r.int(-5, 9)}, M)`, `max_safe(${r.int(4, 9)}, ${r.int(0, 3)}, ${r.int(0, 3)})`]),
  fib: (r) => r.pick([`fib(${r.int(0, 18)}, F)`, `fib(${r.int(5, 12)}, ${r.pick([5, 8, 13, 21, 55, 144])})`]),
  fact: (r) => r.pick([`fact(${r.int(0, 25)}, F)`, `fact(${r.int(1, 6)}, ${r.pick([1, 2, 6, 24, 120, 720])})`]),
  nrev: (r) => r.pick([`nrev(${lists(r)}, R)`, `nrev(${lists(r, 0, 3)}, [${r.int(1, 3)}])`]),
  sum: (r) => r.pick([`sum(${lists(r)}, S)`, `sum(${lists(r, 0, 3, 0, 5)}, ${r.int(0, 10)})`, `sum([1, x], S)`]),
  len: (r) => r.pick([`len(${lists(r)}, N)`, `len(L, ${r.int(0, 2)})`]),
  evens: (r) => `evens(${lists(r)}, R)`,
  grade: (r) => r.pick([`grade(${r.int(30, 100)}, G)`, `grade(${r.int(30, 100)}, ${r.pick(['a', 'b', 'c'])})`]),
  pick: (r) => `pick(X, ${lists(r, 0, 5, 0, 6)})`,
  squares: (r) => `squares(${r.int(0, 7)}, L)`,
  counter: (r) => r.pick([`note(${r.int(1, 9)})`, 'noted(L)']),
  greet: (r) => `greet(${r.pick(['ann', 'bob', '"x y"', 42])})`,
  timed: (r) => `time(fib(${r.int(1, 12)}, F))`
};
QUERIES.timed = (r) => `time(sum(${lists(r, 1, 5, 0, 9)}, S))`;
PROGRAMS.timed = PROGRAMS.sum;

const hybrids = new Map();
const hybridFor = (name) => { if (!hybrids.has(name)) { const h = new Hybrid(P, { stepLimit: 2e5, timeLimitMs: 60000 }); h.setProgram(PROGRAMS[name]); hybrids.set(name, h); } return hybrids.get(name); };

// The edge cases from the "Detlog C vs MNN" checklist: a bound output, commitment, big integers,
// type and instantiation errors, partial lists, and the cut-in-head max_of that is not steadfast.
const EDGES = [
  ['label', 'label([2,3], even(3))'], ['label', 'label([2], none)'], ['label', 'label([2,3], even(2))'], ['label', 'label([-4,1], R)'],
  ['label', 'label([], R)'], ['label', 'label(L, R)'], ['label', 'label([a, 2], R)'], ['label', 'label([1.0, 2], R)'], ['label', 'label([3|T], R)'],
  ['label', 'label([1, X], R)'], ['first_label', 'first([2,3], even(3))'], ['max_of', 'max_of(5, 3, 3)'], ['max_safe', 'max_safe(5, 3, 3)'],
  ['fact', 'fact(20, F)'], ['fact', 'fact(25, F)'], ['fact', 'fact(30, F)'], ['fib', 'fib(24, F)'], ['sum', 'sum([1, x], S)'],
  ['sum', 'sum([9007199254740991, 1], S)'], ['len', 'len(L, 1)'], ['evens', 'evens([-3,-2,0,7], R)'], ['grade', 'grade(x, G)']
];
const runOut = (name, query) => {
  const h = hybridFor(name);
  const res = h.run(query, { check: true });
  const p = res.plan;
  return {
    answers: res.answers, output: res.output, error: res.error,
    // which of C, MNN and Prolog was fastest depends on the machine: recorded only when Prolog had to run it
    on: res.route === 'Prolog' && p.pick !== 'Prolog' ? 'Prolog' : 'the fastest exact route',
    prolog_because: res.route === 'Prolog' && p.pick !== 'Prolog' ? res.why : undefined,
    c_route_applies: p.timing ? p.timing.nativeUsed : undefined,
    point_one: p.pointOne.length ? p.runAs : undefined,
    // the numbers and which converted route won depend on the machine
    time_line: res.timeLine ? res.timeLine.replace(/\d[\d,]*(\.\d+)?|Infinite/g, '#').replace(/\[(C|MNN|Prolog)\]/, '[the fastest route]') : undefined,
    same_as_prolog: res.check.same
  };
};

export const cases = [
  { name: 'run_edge', make: (r) => r.pick(EDGES), run: runOut },
  {
    name: 'run_lists',
    make: (r) => { const name = r.pick(['label', 'first_label', 'nrev', 'sum', 'len', 'evens', 'pick']); return [name, QUERIES[name](r)]; },
    run: runOut
  },
  {
    name: 'run',
    make: (r) => { const name = r.pick(Object.keys(QUERIES)); return [name, QUERIES[name](r)]; },
    run: runOut
  },
  {
    name: 'steadfast',
    make: (r) => { const name = r.pick(Object.keys(PROGRAMS).filter((n) => n !== 'counter')); const prog = P.loadProgram(PROGRAMS[name]); const k = r.pick([...prog.preds.keys()]); return [name, k, r.int(1, Number(k.split('/').pop()))]; },
    run: (name, k, arg) => steadfast(P, P.loadProgram(PROGRAMS[name]), k, arg - 1)
  },
  {
    name: 'point_one',
    make: (r) => { const name = r.pick(['label', 'first_label', 'max_of', 'max_safe', 'fact', 'grade', 'nrev', 'sum']); return [name, QUERIES[name](r)]; },
    run: (name, query) => { const p = pointOne(P, P.loadProgram(PROGRAMS[name]), query); return { run_as: p.text, outputs: p.outputs.map((o) => o.arg) }; }
  },
  {
    name: 'consult',
    make: (r) => {
      const files = { 'lists.pl': 'twice(X, Y) :- Y is 2 * X.', 'lib/maths.pl': 'sq(X, Y) :- Y is X * X.', 'again.pl': ':- consult(lists).\nthrice(X, Y) :- Y is 3 * X.' };
      const how = r.pick([':- consult(lists).', ':- [lists, \'lib/maths\'].', ':- include(\'lib/maths.pl\').', ':- consult(again).\n:- consult(lists).', ':- consult(missing).']);
      return [files, `${how}\nmain(X, Y) :- twice(X, Y).`];
    },
    run: async (files, text) => {
      const fs = new MemoryFiles(files);
      try { return await expandConsults(text, async (n) => { try { return await fs.read(n); } catch { return null; } }); } catch (e) { return { error: e.message }; }
    }
  },
  {
    name: 'time_line',
    make: (r) => [r.int(0, 5_000_000), r.pick([0, 0.5, 12.3456, 1000, 2500.5]), r.pick(['C', 'MNN', 'Prolog'])],
    run: (steps, ms, route) => timeLine(steps, ms, route)
  },
  {
    name: 'files',
    make: (r) => {
      const ops = [];
      const names = ['a.pl', 'b.txt', 'dir/c.pl', 'dir/sub/d.pl'];
      for (let i = 0; i < r.int(2, 6); i++) {
        const op = r.pick(['write', 'write', 'mkdir', 'rename', 'remove', 'read']);
        const n = r.pick(names);
        ops.push(op === 'write' ? ['write', n, `x(${r.int(1, 9)}).`] : op === 'rename' ? ['rename', n, r.pick(['moved.pl', 'dir/moved.pl'])] : op === 'mkdir' ? ['mkdir', r.pick(['dir', 'new'])] : [op, n]);
      }
      return [ops];
    },
    run: async (ops) => {
      const fs = new MemoryFiles();
      const log = [];
      for (const [op, a, b] of ops) {
        try { const v = await fs[op](a, b); log.push(op === 'read' ? v : 'ok'); } catch (e) { log.push(`error: ${e.message}`); }
      }
      const tree = async (d) => Promise.all((await fs.list(d)).map(async (e) => (e.type === 'dir' ? { [e.name]: await tree(d ? `${d}/${e.name}` : e.name) } : e.name)));
      return { log, tree: await tree('') };
    }
  }
];
