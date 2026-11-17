// The built page is one file that runs with no server: no modules left, every script parses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { build } from '../scripts/build.mjs';

test('dist/index.html is self-contained', () => {
  build();
  const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src=|type="module"|<link rel="stylesheet"/);
  const scripts = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  for (const s of scripts) new vm.Script(s);
  assert.doesNotMatch(scripts[1], /^\s*(import|export)\s/m);
  for (const f of ['manifest.webmanifest', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png']) assert.ok(fs.existsSync(new URL(`../dist/${f}`, import.meta.url)), f);
});
