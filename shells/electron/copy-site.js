// Copies the built site (../../dist, made by `node scripts/build.mjs`) into site/ for the app.
const fs = require('fs');
const path = require('path');
const from = path.join(__dirname, '..', '..', 'dist');
const to = path.join(__dirname, 'site');
if (!fs.existsSync(path.join(from, 'index.html'))) throw new Error('Build the site first: node scripts/build.mjs');
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log('copied the site into', to);
