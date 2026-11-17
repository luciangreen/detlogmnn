// The device-file interface, on the in-memory store the tests use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFiles, basename, dirname, join } from '../web/lib/files.js';

test('paths', () => {
  assert.equal(join('a', '', 'b/c.pl'), 'a/b/c.pl');
  assert.equal(join('/a//b/', './c'), 'a/b/c');
  assert.equal(dirname('a/b/c.pl'), 'a/b');
  assert.equal(basename('a/b/c.pl'), 'c.pl');
  assert.throws(() => join('a', '../b'), /not allowed/);
});

test('write, list, read, rename, remove', async () => {
  const fs = new MemoryFiles();
  await fs.write('p/one.pl', 'a.');
  await fs.write('p/two.pl', new TextEncoder().encode('b.'));
  await fs.mkdir('empty');
  assert.deepEqual((await fs.list('')).map((e) => `${e.type}:${e.name}`), ['dir:empty', 'dir:p']);
  assert.deepEqual((await fs.list('p')).map((e) => e.name), ['one.pl', 'two.pl']);
  assert.equal(await fs.read('p/two.pl'), 'b.');
  await fs.rename('p', 'q');
  assert.equal(await fs.read('q/one.pl'), 'a.');
  assert.equal(await fs.exists('p/one.pl'), false);
  await fs.remove('q/one.pl');
  assert.deepEqual((await fs.list('q')).map((e) => e.name), ['two.pl']);
  await assert.rejects(fs.read('nope.pl'), /no file/);
});
