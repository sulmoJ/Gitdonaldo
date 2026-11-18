'use strict';

// End-to-end check of the Electron app (dev build, or a packaged binary passed as argv[2]).
//   npm run test:e2e                       # dev: electron .
//   npm run test:e2e -- dist/linux-unpacked/gitdonaldo
// Headless Linux: xvfb-run -a npm run test:e2e

const { _electron: electron } = require('playwright-core');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const packaged = process.argv[2] ? path.resolve(process.argv[2]) : null;
const exe = packaged || require('electron');
const sandboxFlag = process.platform === 'linux' ? ['--no-sandbox'] : [];
const appArgs = packaged ? sandboxFlag : [...sandboxFlag, ROOT];

const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-cfg-'));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-repo-'));
const g = (...a) => execFileSync('git', ['-C', repo, ...a]);
g('init', '-q', '-b', 'main');
for (const m of ['one', 'two']) g('-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', m);

// Isolate settings.json (userData) from the real profile.
const env = { ...process.env, GITDONALDO_USER_DATA: cfg };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const firstWindowPrefs = ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();

function rawStatus(port, p, headers) {
  return new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p, headers }, (r) => { r.resume(); res(r.statusCode); }).on('error', rej));
}

(async () => {
  // ---- first launch: no repo yet ------------------------------------------------------
  let app = await electron.launch({ executablePath: exe, args: appArgs, env });
  let win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await win.waitForFunction(() => document.querySelector('#repoinfo').textContent !== 'loading…');
  check(/열기 버튼/.test(await win.textContent('#repoinfo')), 'first launch asks to open a folder');
  check(await win.isVisible('#openBtn'), 'open button is visible');

  const url = new URL(win.url());
  const token = url.searchParams.get('token');
  check(url.hostname === '127.0.0.1' && Number(url.port) > 0 && /^[0-9a-f]{64}$/.test(token || ''), 'loopback, random port, per-launch token');

  const prefs = await app.evaluate(firstWindowPrefs);
  check(prefs.contextIsolation && !prefs.nodeIntegration && prefs.sandbox, 'contextIsolation + sandbox on, nodeIntegration off');
  check(await win.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined'), 'no Node globals in renderer');
  check(JSON.stringify(await win.evaluate(() => Object.keys(window.gitdonaldo).sort()))
    === JSON.stringify(['isDesktop', 'onOpenRepoRequest', 'rememberRepo', 'selectRepo']), 'bridge exposes only 4 members');

  // ---- backend hardening --------------------------------------------------------------
  const api = `${url.origin}/api/repo?repo=${encodeURIComponent(repo)}`;
  check((await fetch(api)).status === 403, 'API without token -> 403');
  check((await fetch(api, { headers: { 'x-gitdonaldo-token': token } })).status === 200, 'API with token -> 200');
  check(await rawStatus(url.port, '/', { host: 'evil.example' }) === 403, 'foreign Host header -> 403');
  check(((await fetch(`${url.origin}/`)).headers.get('content-security-policy') || '').includes("default-src 'self'"), 'CSP header');

  // ---- open a repo (dialog stubbed) ---------------------------------------------------
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, repo);
  await win.click('#openBtn');
  await win.waitForSelector('#commitList li');
  check(await win.locator('#commitList li').count() === 2, 'selected repo shows its 2 commits');
  await win.click('#commitList li');
  await win.waitForSelector('#detailBody h2');
  check(await win.textContent('#detailBody h2') === 'two', 'commit detail loads');
  check(errors.length === 0, `no renderer errors ${errors.length ? JSON.stringify(errors) : ''}`);

  // ---- navigation lock (keep last: Playwright treats the cancelled navigation as pending)
  await win.evaluate(() => { location.href = 'https://example.com/'; });
  await sleep(800);
  check(await app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0].webContents.getURL().startsWith(origin), url.origin),
    'navigation outside the app is blocked');
  await app.close();

  // ---- relaunch: last repo, single instance --------------------------------------------
  app = await electron.launch({ executablePath: exe, args: appArgs, env });
  win = await app.firstWindow();
  await win.waitForSelector('#commitList li', { timeout: 15000 });
  check((await win.textContent('#repoinfo')).includes(path.basename(repo)), 'relaunch reopens the last repo');
  const second = spawnSync(exe, appArgs, { env, timeout: 15000 });
  check(second.status === 0 && !second.error, 'second launch exits (single-instance lock)');
  await app.close();

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
