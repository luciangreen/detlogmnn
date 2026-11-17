// Files on the device: one interface, several places they can live.
//
//   bridge  the LucianOS app shells: the iPhone/iPad app (files in the app's Documents folder,
//           shown in the Files app), the Android app (files in its folder on the phone's storage)
//           and the desktop app (a folder on the computer, Documents/<app> by default).
//   folder  a browser that can open a folder on the computer (Chrome and Edge on a computer):
//           the folder you pick, remembered between visits.
//   opfs    any other browser (Safari on iPhone, Chrome on Android): the browser's private file
//           storage on the device, with Import and Export to move files in and out.
//   memory  for tests.
//
// Every place has the same calls: list, read, readBytes, write, mkdir, remove, rename, exists.
// Paths are relative and use '/'.

const enc = new TextEncoder();
const dec = new TextDecoder();
const clean = (p) => String(p ?? '').split('/').filter((s) => s && s !== '.').map((s) => { if (s === '..') throw new Error('.. is not allowed in a path'); return s; }).join('/');
const parts = (p) => clean(p).split('/').filter(Boolean);
export const join = (...ps) => clean(ps.filter(Boolean).join('/'));
export const dirname = (p) => parts(p).slice(0, -1).join('/');
export const basename = (p) => parts(p).pop() ?? '';
const b64 = {
  from: (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); },
  to: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
};
const sortEntries = (es) => es.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));

// ---- the app shells' bridge ----
// Request { op, path, to?, data?, encoding? } -> reply { ok, entries? | data? | exists? | error? }.
function bridgeTransport() {
  if (globalThis.lucianNative?.fs) return { name: 'desktop app', send: (req) => globalThis.lucianNative.fs(req) };
  const ios = globalThis.webkit?.messageHandlers?.lucianfs;
  if (ios) return { name: 'iPhone app', send: (req) => ios.postMessage(req) };
  if (globalThis.LucianAndroid?.fs) return { name: 'Android app', send: async (req) => JSON.parse(globalThis.LucianAndroid.fs(JSON.stringify(req))) };
  return null;
}
class BridgeFiles {
  constructor(t) { this.t = t; this.kind = 'bridge'; this.where = t.name; }
  async call(req) {
    const r = await this.t.send(req);
    if (!r || !r.ok) throw new Error(r?.error ?? `couldn't ${req.op} ${req.path}`);
    return r;
  }
  async list(p = '') { return sortEntries((await this.call({ op: 'list', path: clean(p) })).entries); }
  async read(p) { return (await this.call({ op: 'read', path: clean(p), encoding: 'utf8' })).data; }
  async readBytes(p) { return b64.to((await this.call({ op: 'read', path: clean(p), encoding: 'base64' })).data); }
  async write(p, data) {
    const bytes = typeof data === 'string';
    await this.call({ op: 'write', path: clean(p), encoding: bytes ? 'utf8' : 'base64', data: bytes ? data : b64.from(data) });
  }
  async mkdir(p) { await this.call({ op: 'mkdir', path: clean(p) }); }
  async remove(p) { await this.call({ op: 'remove', path: clean(p) }); }
  async rename(a, b) { await this.call({ op: 'rename', path: clean(a), to: clean(b) }); }
  async exists(p) { return (await this.call({ op: 'stat', path: clean(p) })).exists; }
  async share(p) { try { await this.call({ op: 'share', path: clean(p) }); return true; } catch { return false; } }
  async root() { try { return (await this.call({ op: 'root', path: '' })).data; } catch { return this.where; } }
}

// ---- a directory handle: a picked folder or the browser's private storage ----
class HandleFiles {
  constructor(dir, kind, where) { this.dir = dir; this.kind = kind; this.where = where; }
  async at(p, { create = false, dir = false } = {}) {
    const ps = parts(p);
    let h = this.dir;
    for (let i = 0; i < ps.length; i++) {
      const last = i === ps.length - 1;
      if (last && !dir) return h.getFileHandle(ps[i], { create });
      h = await h.getDirectoryHandle(ps[i], { create });
    }
    return h;
  }
  async list(p = '') {
    const d = await this.at(p, { dir: true });
    const out = [];
    for await (const [name, h] of d.entries()) {
      if (h.kind === 'directory') out.push({ name, type: 'dir' });
      else { const f = await h.getFile(); out.push({ name, type: 'file', size: f.size, mtime: f.lastModified }); }
    }
    return sortEntries(out);
  }
  async readBytes(p) { return new Uint8Array(await (await (await this.at(p)).getFile()).arrayBuffer()); }
  async read(p) { return dec.decode(await this.readBytes(p)); }
  async write(p, data) {
    if (dirname(p)) await this.at(dirname(p), { create: true, dir: true });
    const w = await (await this.at(p, { create: true })).createWritable();
    await w.write(typeof data === 'string' ? enc.encode(data) : data);
    await w.close();
  }
  async mkdir(p) { await this.at(p, { create: true, dir: true }); }
  async remove(p) { const d = await this.at(dirname(p), { dir: true }); await d.removeEntry(basename(p), { recursive: true }); }
  async rename(a, b) {
    const copy = async (from, to) => {
      const ents = await this.list(from).catch(() => null);
      if (ents) { await this.mkdir(to); for (const e of ents) await copy(join(from, e.name), join(to, e.name)); }
      else await this.write(to, await this.readBytes(from));
    };
    await copy(a, b);
    await this.remove(a);
  }
  async exists(p) {
    try { await this.at(p); return true; } catch { try { await this.at(p, { dir: true }); return true; } catch { return false; } }
  }
  async root() { return this.where; }
}

// ---- memory, for tests ----
export class MemoryFiles {
  constructor(seed = {}) { this.kind = 'memory'; this.where = 'memory'; this.m = new Map(); for (const [k, v] of Object.entries(seed)) this.m.set(clean(k), typeof v === 'string' ? enc.encode(v) : v); this.d = new Set(['']); }
  async list(p = '') {
    const base = clean(p); const pre = base ? `${base}/` : '';
    if (base && !this.d.has(base) && ![...this.m.keys()].some((k) => k.startsWith(pre))) throw new Error(`no folder ${base}`);
    const out = new Map();
    for (const k of [...this.m.keys(), ...this.d]) {
      if (!k.startsWith(pre) || k === base) continue;
      const rest = k.slice(pre.length).split('/');
      if (rest.length > 1 || this.d.has(k)) out.set(rest[0], { name: rest[0], type: 'dir' });
      else out.set(rest[0], { name: rest[0], type: 'file', size: this.m.get(k).length });
    }
    return sortEntries([...out.values()]);
  }
  async readBytes(p) { const v = this.m.get(clean(p)); if (!v) throw new Error(`no file ${clean(p)}`); return v; }
  async read(p) { return dec.decode(await this.readBytes(p)); }
  async write(p, data) { this.m.set(clean(p), typeof data === 'string' ? enc.encode(data) : data); }
  async mkdir(p) { this.d.add(clean(p)); }
  async remove(p) { const c = clean(p); this.m.delete(c); this.d.delete(c); for (const k of [...this.m.keys()]) if (k.startsWith(`${c}/`)) this.m.delete(k); }
  async rename(a, b) { const A = clean(a), B = clean(b); for (const [k, v] of [...this.m]) if (k === A || k.startsWith(`${A}/`)) { this.m.delete(k); this.m.set(B + k.slice(A.length), v); } }
  async exists(p) { const c = clean(p); return this.m.has(c) || this.d.has(c) || [...this.m.keys()].some((k) => k.startsWith(`${c}/`)); }
  async root() { return 'memory'; }
}

// ---- remembering a picked folder (IndexedDB holds the handle) ----
const IDB_NAME = 'lucian-files';
function idb(mode, f) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(IDB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('h');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('h', mode);
      const r = f(tx.objectStore('h'));
      tx.oncomplete = () => resolve(r?.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}

// The best place this device offers. app: the app's name, used for the folder name.
export async function openFiles(app = 'LucianOS') {
  const t = bridgeTransport();
  if (t) return new BridgeFiles(t);
  if (globalThis.indexedDB && globalThis.showDirectoryPicker) {
    try { // (IndexedDB may be missing on file://: then the folder is chosen again each visit)
      const h = await idb('readonly', (s) => s.get(app));
      if (h && (await h.queryPermission({ mode: 'readwrite' })) === 'granted') return new HandleFiles(h, 'folder', h.name);
    } catch { /* fall through */ }
  }
  if (globalThis.navigator?.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      navigator.storage.persist?.().catch(() => {});
      return new HandleFiles(await root.getDirectoryHandle(app, { create: true }), 'opfs', 'this browser on this device');
    } catch { /* a page opened from the file system has no browser storage in some browsers */ }
  }
  // nowhere to keep files: they last while the page is open (choose a folder to keep them)
  const m = new MemoryFiles();
  m.where = 'only while this page is open';
  m.kind = 'memory';
  return m;
}

// Can this browser use a folder on the computer? (Chrome and Edge on a computer.)
export const canPickFolder = () => !!globalThis.showDirectoryPicker && !bridgeTransport();

// Asks for a folder on the computer and remembers it. Must be called from a click.
export async function pickFolder(app = 'LucianOS') {
  const h = await showDirectoryPicker({ id: app, mode: 'readwrite', startIn: 'documents' });
  await idb('readwrite', (s) => s.put(h, app)).catch(() => {});
  return new HandleFiles(h, 'folder', h.name);
}
// A remembered folder whose permission lapsed (after a browser restart): ask again, from a click.
export async function reopenFolder(app = 'LucianOS') {
  const h = await idb('readonly', (s) => s.get(app));
  if (h && (await h.requestPermission({ mode: 'readwrite' })) === 'granted') return new HandleFiles(h, 'folder', h.name);
  return null;
}

// Files from the device's picker (Photos, Files, Downloads...) into a folder here.
export function importFiles(files, folder = '', { accept = '' } = {}) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept });
    input.onchange = async () => {
      const done = [];
      for (const f of input.files) { await files.write(join(folder, f.name), new Uint8Array(await f.arrayBuffer())); done.push(f.name); }
      resolve(done);
    };
    input.click();
  });
}

// A file out to the device: the share sheet where there is one (phones), else a download.
export async function exportFile(files, path, type = 'application/octet-stream') {
  if (files.share && await files.share(path)) return 'shared';
  const blob = new Blob([await files.readBytes(path)], { type });
  const file = new File([blob], basename(path), { type });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return 'shared'; } catch { /* cancelled */ } }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: basename(path) });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'downloaded';
}
