// Loads pl2detlog (a plain browser script) for tests in Node, as the page does: it puts PL2D on
// the global object.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../web/lib/pl2detlog.js', import.meta.url), 'utf8');
new Function('module', src)({ exports: {} });
export const P = globalThis.PL2D;
