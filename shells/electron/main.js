// Detlog MNN for Mac, Windows and Linux: the site (site/index.html) in a desktop-sized window. Its
// files are in a folder on the computer: Documents/Detlog MNN, or another chosen from the File menu.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { handle } = require('./fsbridge');

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
