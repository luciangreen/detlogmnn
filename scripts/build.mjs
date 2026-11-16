// Builds dist/: the site as one self-contained index.html (styles, scripts and the app's modules
// inlined as plain scripts), so it opens straight from the file system (file://) with no server,
// as well as from a web host and inside the iPhone, Android and desktop apps. Icons, the
// manifest and the offline service worker are copied beside it. No dependencies.
//   node scripts/build.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const web = path.join(root, 'web');
const out = path.join(root, 'dist');
const read = (f) => fs.readFileSync(f, 'utf8');

// ES modules to plain scripts: each module becomes a function returning its exports, called once
// in dependency order; `import { a, b as c } from './x.js'` becomes `const { a, b: c } = <x>`.
export function bundle(entry) {
  const order = [];
  const ids = new Map();
  const visit = (file) => {
    if (ids.has(file)) return;
    ids.set(file, `__m${ids.size}`);
    const src = read(file);
    for (const m of src.matchAll(/^import\s*\{[^}]*\}\s*from\s*'([^']+)';?\s*$/gm)) visit(path.resolve(path.dirname(file), m[1]));
    order.push(file);
  };
  visit(entry);
  const parts = order.map((file) => {
    let src = read(file);
    const names = [];
    src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm, (_, list, from) => {
      const id = ids.get(path.resolve(path.dirname(file), from));
      return `const { ${list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/^(\w+)\s+as\s+(\w+)$/, '$1: $2')).join(', ')} } = ${id};`;
    });
    if (/^\s*import\s/m.test(src)) throw new Error(`${file}: only "import { ... } from './file.js'" is supported`);
    src = src.replace(/^export\s+((?:async\s+)?function\*?|class|const|let)\s+(\w+)/gm, (_, kw, name) => { names.push(name); return `${kw} ${name}`; });
    if (/^export\s/m.test(src)) throw new Error(`${file}: unsupported export`);
    return `const ${ids.get(file)} = (() => {\n'use strict';\n${src}\nreturn { ${names.join(', ')} };\n})();`;
  });
  return parts.join('\n');
}

export function build() {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  let html = read(path.join(web, 'index.html'));
  const safe = (s, what) => { if (/<\/script/i.test(s)) throw new Error(`${what} contains </script`); return s; };
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, f) => `<style>\n${read(path.join(web, f))}</style>`);
  html = html.replace(/<script type="module" src="([^"]+)"><\/script>/g, (_, f) => `<script>\n${safe(bundle(path.join(web, f)), f)}\n</script>`);
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, f) => `<script>\n${safe(read(path.join(web, f)), f)}\n</script>`);
  fs.writeFileSync(path.join(out, 'index.html'), html);
  for (const f of fs.readdirSync(web, { recursive: true })) {
    const from = path.join(web, f);
    if (fs.statSync(from).isDirectory() || /\.(js|css|html)$/.test(f) && f !== 'sw.js') continue;
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.copyFileSync(from, path.join(out, f));
  }
  return html.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  console.log(`built dist/index.html (${(build() / 1024).toFixed(0)} KB)`);
}
