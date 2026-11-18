'use strict';

// Electron entry point: runs the git backend (server.js) in this process on a random
// loopback port and shows the existing UI in a sandboxed window.

const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require('electron');
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { start } = require('../server.js');

const IPC = {
  selectRepo: 'gitdonaldo:select-repo',
  rememberRepo: 'gitdonaldo:remember-repo',
  openRepoRequest: 'gitdonaldo:open-repo-request',
};

let backend = null;   // { port, url, close }
let token = null;     // per-launch API token
let mainWindow = null;

// ---- settings (userData/settings.json) -------------------------------------------------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}; } catch { return {}; }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  } catch (e) {
    console.error('[Gitdonaldo] could not save settings:', e.message);
  }
}

// ---- git discovery -----------------------------------------------------------------------

// Apps launched from Finder/Explorer do not inherit the shell PATH, so add the usual
// git install locations. settings.json may also name a git binary via "gitPath".
function extendPath() {
  const extra = {
    darwin: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'],
    linux: ['/usr/local/bin', '/usr/bin'],
    win32: ['C:\\Program Files\\Git\\cmd', 'C:\\Program Files (x86)\\Git\\cmd'],
  }[process.platform] || [];
  const { gitPath } = readSettings();
  if (typeof gitPath === 'string' && gitPath) extra.unshift(path.dirname(gitPath));
  const current = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  process.env.PATH = [...extra.filter((d) => !current.includes(d)), ...current].join(path.delimiter);
}

function gitVersion() {
  return new Promise((resolve) => {
    execFile('git', ['--version'], (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

// ---- window ------------------------------------------------------------------------------

function isAppUrl(u) {
  return backend && typeof u === 'string' && (u === backend.url || u.startsWith(backend.url + '/'));
}

function startUrl() {
  const q = new URLSearchParams({ token });
  const { lastRepo } = readSettings();
  if (typeof lastRepo === 'string' && lastRepo && fs.existsSync(lastRepo)) q.set('repo', lastRepo);
  return `${backend.url}/?${q}`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    title: 'Gitdonaldo',
    backgroundColor: '#15171c',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(startUrl());
}

function requestOpenRepo() {
  if (mainWindow) mainWindow.webContents.send(IPC.openRepoRequest);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Repository…', accelerator: 'CmdOrCtrl+O', click: requestOpenRepo },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- hardening ---------------------------------------------------------------------------

function harden() {
  // No camera, notifications, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
    contents.on('will-redirect', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

function fromApp(event) {
  return isAppUrl(event.senderFrame && event.senderFrame.url);
}

function registerIpc() {
  ipcMain.handle(IPC.selectRepo, async (event) => {
    if (!fromApp(event)) return null;
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Git 저장소 폴더 선택',
      properties: ['openDirectory'],
    });
    return canceled || !filePaths.length ? null : filePaths[0];
  });
  ipcMain.on(IPC.rememberRepo, (event, repoPath) => {
    if (!fromApp(event) || typeof repoPath !== 'string' || !repoPath) return;
    writeSettings({ lastRepo: repoPath });
  });
}

// ---- lifecycle ---------------------------------------------------------------------------

// Lets tests run against a throwaway profile (settings.json, caches).
if (process.env.GITDONALDO_USER_DATA) app.setPath('userData', process.env.GITDONALDO_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    extendPath();
    const version = await gitVersion();
    if (!version) {
      dialog.showErrorBox(
        'git을 찾을 수 없습니다',
        'Gitdonaldo는 시스템에 설치된 git을 사용합니다.\n'
        + 'git을 설치한 뒤 다시 실행하세요. (https://git-scm.com/downloads)\n\n'
        + `git이 다른 위치에 있다면 다음 파일에 "gitPath"를 지정하세요:\n${settingsFile()}`,
      );
      app.quit();
      return;
    }

    token = crypto.randomBytes(32).toString('hex');
    backend = await start({ port: 0, defaultRepo: null, token });
    console.log(`[Gitdonaldo] ${version}; backend on ${backend.url}`);

    harden();
    registerIpc();
    buildMenu();
    createWindow();

    app.on('activate', () => { if (!mainWindow) createWindow(); });
  }).catch((e) => {
    dialog.showErrorBox('Gitdonaldo를 시작하지 못했습니다', String(e && e.stack || e));
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    if (backend) backend.close();
  });
}
