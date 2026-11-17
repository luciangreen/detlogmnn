// Detlog MNN for Mac, Windows and Linux: the site (site/index.html) in a desktop-sized window. Its
// files are in a folder on the computer: Documents/Detlog MNN, or another chosen from the File menu.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { handle, inside } = require('./fsbridge');

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const settings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } };
const save = (s) => { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); };
const root = () => settings().folder || path.join(app.getPath('documents'), 'Detlog MNN');

let win;
function create() {
  const s = settings();
  win = new BrowserWindow({
    width: s.width || 1280, height: s.height || 820, minWidth: 360, minHeight: 500,
    title: 'Detlog MNN', backgroundColor: '#fffaf5',
    icon: path.join(__dirname, 'site', 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'site', 'index.html'));
  win.on('close', () => { const [width, height] = win.getSize(); save({ ...settings(), width, height }); });
  // links to other sites open in the browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (/^https?:/.test(url)) { e.preventDefault(); shell.openExternal(url); } });
}

ipcMain.handle('lucian-fs', (_e, req) => handle(root(), req || {}, { reveal: (p) => shell.showItemInFolder(p) }));

// Commands on the computer (shellrun, the terminal, swipl), run in the files folder, as the LucianOS
// server runs them: output and the end are sent back to the page as they happen.
const running = new Map();
ipcMain.handle('lucian-job-start', (e, id, spec) => {
  const send = (event, data) => { if (!e.sender.isDestroyed()) e.sender.send('lucian-job-event', { id, event, data }); };
  let cwd;
  try { cwd = inside(root(), spec.cwd || ''); fs.mkdirSync(cwd, { recursive: true }); } catch (err) { send('end', { exitCode: 2, status: 'failed' }); return { ok: false, error: err.message }; }
  const child = spawn(spec.cmd, spec.args || [], { cwd, env: { ...process.env, ...(spec.env || {}) }, windowsHide: true });
  running.set(id, child);
  child.stdout.on('data', (d) => send('output', { stream: 'stdout', text: d.toString() }));
  child.stderr.on('data', (d) => send('output', { stream: 'stderr', text: d.toString() }));
  child.on('error', (err) => { send('output', { stream: 'stderr', text: `${spec.cmd}: ${err.message}\n` }); });
  child.on('close', (code, signal) => { running.delete(id); send('end', { exitCode: code, signal, status: signal ? 'cancelled' : code === 0 ? 'done' : 'failed' }); });
  if (spec.stdin === false) child.stdin.end();
  return { ok: true };
});
ipcMain.handle('lucian-job-input', (_e, id, text) => { running.get(id)?.stdin.write(text); return { ok: true }; });
ipcMain.handle('lucian-job-cancel', (_e, id) => { running.get(id)?.kill(); return { ok: true }; });

function menu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Show Files Folder', click: () => shell.openPath(root()) },
        {
          label: 'Choose Files Folder…',
          click: async () => {
            const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: root() });
            if (!r.canceled && r.filePaths[0]) { save({ ...settings(), folder: r.filePaths[0] }); win.reload(); }
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' }
  ]));
}

app.whenReady().then(() => { menu(); create(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) create(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
