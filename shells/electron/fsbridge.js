// The file bridge the site calls as window.lucianNative.fs(request): the same requests the iPhone and
// Android apps answer. Every path is inside the app's folder (Documents/<app name> unless the person
// chose another), and may not leave it.
const fs = require('fs/promises');
const path = require('path');

function inside(root, rel) {
  const p = path.resolve(root, String(rel || '').replace(/^\/+/, ''));
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('outside the app folder');
  return p;
}

async function handle(root, req, { reveal } = {}) {
  try {
    await fs.mkdir(root, { recursive: true });
    const p = inside(root, req.path);
    switch (req.op) {
      case 'root': return { ok: true, data: root };
      case 'list': {
        const ents = await fs.readdir(p, { withFileTypes: true });
        const entries = await Promise.all(ents.filter((e) => !e.name.startsWith('.')).map(async (e) => {
          if (e.isDirectory()) return { name: e.name, type: 'dir' };
          const st = await fs.stat(path.join(p, e.name));
          return { name: e.name, type: 'file', size: st.size, mtime: st.mtimeMs };
        }));
        return { ok: true, entries };
      }
      case 'read': {
        const buf = await fs.readFile(p);
        return { ok: true, data: req.encoding === 'base64' ? buf.toString('base64') : buf.toString('utf8') };
      }
      case 'write':
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, req.encoding === 'base64' ? Buffer.from(req.data, 'base64') : String(req.data ?? ''));
        return { ok: true };
      case 'mkdir': await fs.mkdir(p, { recursive: true }); return { ok: true };
      case 'remove': if (p === root) throw new Error("can't remove the app folder"); await fs.rm(p, { recursive: true, force: true }); return { ok: true };
      case 'rename': { const q = inside(root, req.to); await fs.mkdir(path.dirname(q), { recursive: true }); await fs.rename(p, q); return { ok: true }; }
      case 'stat': try { await fs.stat(p); return { ok: true, exists: true }; } catch { return { ok: true, exists: false }; }
      case 'share': if (reveal) { reveal(p); return { ok: true }; } return { ok: false, error: 'no share here' };
      default: return { ok: false, error: `unknown request ${req.op}` };
    }
  } catch (e) {
    return { ok: false, error: e.code === 'ENOENT' ? `no such file or folder: ${req.path}` : e.message };
  }
}

module.exports = { handle, inside };
