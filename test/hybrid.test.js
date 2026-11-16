// The hybrid: every query gives Prolog's answers, whichever route runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P } from './load.mjs';
import { Hybrid, expandConsults, pointOne, reaches, steadfast, timeLine } from '../web/lib/hybrid.js';
import { PROGRAMS } from '../io/cases.mjs';

const LABEL = PROGRAMS.label;
const make = (src) => { const h = new Hybrid(P, { stepLimit: 2e5 }); h.setProgram(src); return h; };

test('label/2: the "Detlog C vs MNN" checklist', () => {
  const h = make(LABEL);
  const run = (q) => { const r = h.run(q, { check: true }); assert.equal(r.check.same, true, `${q} agrees with Prolog`); return r.error ?? (r.answers.join('; ') || 'false'); };
  assert.equal(run('label([1,3,4,6], R)'), 'R = even(4)', 'the first even element, left to right');
  assert.equal(run('label([1,3], R)'), 'R = none');
  assert.equal(run('label([], R)'), 'R = none');
  assert.equal(run('label([2,3], even(3))'), 'false', 'point 1: commits to 2, so even(3) fails');
  assert.equal(run('label([2], none)'), 'false');
  assert.equal(run('label([2,3], even(2))'), 'true');
  assert.equal(run('label([-4,1], R)'), 'R = even(-4)', 'mod takes the divisor\'s sign');
  assert.equal(run('label(L, R)'), 'instantiation_error');
  assert.equal(run('label([a, 2], R)'), 'type_error(evaluable, a/0)');
  assert.equal(run('label([1.0, 2], R)'), 'type_error(integer, 1.0)');
  assert.equal(run('label([3|T], R)'), 'instantiation_error', 'a partial list');
});

test('point 1 only where the output is proved steadfast', () => {
  const prog = P.loadProgram(`${LABEL}\n${PROGRAMS.max_of}\n${PROGRAMS.max_safe}\n${PROGRAMS.fib}\nfirst(L, R) :- label(L, R).\nlast2(L, R) :- label(L, R), R \\== none.`);
  assert.equal(steadfast(P, prog, 'label/2', 1).ok, true);
  assert.equal(steadfast(P, prog, 'first/2', 1).ok, true, 'passed on to a steadfast argument (C)');
  assert.equal(steadfast(P, prog, 'max_safe/3', 2).ok, true);
  assert.equal(steadfast(P, prog, 'max_of/3', 2).ok, false, 'the cut-in-head max: max_of(5, 3, 3) is true in Prolog');
  assert.equal(steadfast(P, prog, 'fib/2', 1).ok, false, 'a value in the head');
  assert.equal(steadfast(P, prog, 'last2/2', 1).ok, false, 'used after it is computed');
  assert.equal(pointOne(P, prog, 'label([2,3], even(3))').text, 'label([2, 3], _O2), _O2 = even(3)');
  assert.equal(pointOne(P, prog, 'max_of(5, 3, 3)').text, 'max_of(5, 3, 3)');
  assert.equal(make(PROGRAMS.max_of).run('max_of(5, 3, 3)').answers.join(), 'true', 'as Prolog');
});

test('the routes agree with Prolog on every example program', () => {
  const queries = {
    fib: ['fib(15, F)', 'fib(10, 55)', 'fib(10, 54)'], fact: ['fact(25, F)', 'fact(5, 120)'], nrev: ['nrev([a,b,c], R)'],
    sum: ['sum([1,2,3], S)', 'sum([9007199254740991, 2], S)'], evens: ['evens([1,2,3,4], R)'], grade: ['grade(70, G)', 'grade(70, a)'],
    pick: ['pick(X, [1,3,5])'], squares: ['squares(4, L)'], greet: ['greet(ann)'], counter: ['note(1)']
  };
  for (const [name, qs] of Object.entries(queries)) {
    const h = make(PROGRAMS[name]);
    for (const q of qs) assert.equal(h.run(q, { check: true }).check.same, true, `${name}: ${q}`);
  }
  assert.equal(make(PROGRAMS.fact).run('fact(30, F)').answers[0], 'F = 265252859812191058636308480000000', 'unbounded integers');
  assert.equal(make(PROGRAMS.sum).run('sum([9007199254740991, 2], S)').answers[0], 'S = 9007199254740993');
});

test('what runs on Prolog, and why', () => {
  const h = make(PROGRAMS.counter);
  const r = h.run('note(3)');
  assert.equal(r.route, 'Prolog');
  assert.match(r.why, /assert\/retract/);
  const g = make(`${PROGRAMS.counter}\n${PROGRAMS.fib}`);
  assert.notEqual(g.run('fib(10, F)').route, 'Prolog', 'only queries that reach the database go to Prolog');
  assert.ok(reaches(P, g.prog, P.readTerm('note(1)').term).has('assertz/1'));
  const e = make(PROGRAMS.len).run('len(L, 1)');
  assert.equal(e.route, 'Prolog');
  assert.deepEqual(e.answers, ['L = [_A]'], 'Prolog gives the answer it finds before the limit');
});

test('time/1', () => {
  const r = make(PROGRAMS.fib).run('time(fib(12, F))');
  assert.deepEqual(r.answers, ['F = 144']);
  assert.match(r.timeLine, /^% [\d,]+ inferences, [\d.]+ CPU in [\d.]+ seconds \(100% CPU, ([\d,]+|Infinite) Lips\) \[(C|MNN|Prolog)\]\n$/);
  const p = P.runQuery(P.loadProgram(PROGRAMS.fib), 'time(fib(5, F))');
  assert.deepEqual(p.answers.map((a) => a.text), ['F = 5']);
  assert.equal((p.output.match(/inferences/g) ?? []).length, 1, 'reported once, in a program on the Prolog route');
  assert.equal(timeLine(1234567, 1500, 'C'), '% 1,234,567 inferences, 1.500 CPU in 1.500 seconds (100% CPU, 823,045 Lips) [C]\n');
});

test('consult reads other files once', async () => {
  const files = { 'a.pl': ':- consult(b).\na(1).', 'b.pl': 'b(2).' };
  const text = await expandConsults(':- consult(a).\n:- [b].\nmain.', async (n) => files[n] ?? null);
  assert.match(text, /a\(1\)/);
  assert.equal((text.match(/b\(2\)/g) ?? []).length, 1);
  await assert.rejects(expandConsults(':- consult(nope).', async () => null), /can't find nope.pl/);
});
