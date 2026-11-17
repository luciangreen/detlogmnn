// The desktop app's file bridge (shells/electron/fsbridge.js), run in Node without Electron: the
// requests the site sends, answered in a folder, and never outside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { handle } = require('../shells/electron/fsbridge.js');

test('the file bridge', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-'));
  const call = (req) => handle(root, req);
  assert.deepEqual(await call({ op: 'write', path: 'a/b.pl', data: 'x.', encoding: 'utf8' }), { ok: true });
  assert.equal((await call({ op: 'read', path: 'a/b.pl', encoding: 'utf8' })).data, 'x.');
  assert.equal((await call({ op: 'read', path: 'a/b.pl', encoding: 'base64' })).data, Buffer.from('x.').toString('base64'));
  await call({ op: 'write', path: 'img.bin', data: Buffer.from([0, 255, 7]).toString('base64'), encoding: 'base64' });
  assert.deepEqual([...fs.readFileSync(path.join(root, 'img.bin'))], [0, 255, 7]);
  const list = await call({ op: 'list', path: '' });
  assert.deepEqual(list.entries.map((e) => `${e.type}:${e.name}`).sort(), ['dir:a', 'file:img.bin']);
  assert.deepEqual(await call({ op: 'rename', path: 'a/b.pl', to: 'c/d.pl' }), { ok: true });
  assert.equal((await call({ op: 'stat', path: 'c/d.pl' })).exists, true);
  assert.equal((await call({ op: 'stat', path: 'a/b.pl' })).exists, false);
  assert.deepEqual(await call({ op: 'remove', path: 'c' }), { ok: true });
  assert.match((await call({ op: 'read', path: 'nope.pl' })).error, /no such file/);
  assert.match((await call({ op: 'read', path: '../outside.txt' })).error, /outside the app folder/);
  assert.match((await call({ op: 'remove', path: '' })).error, /can't remove the app folder/);
  assert.equal((await call({ op: 'root' })).data, root);
});
