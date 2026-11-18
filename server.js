'use strict';

const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 4317;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_REPO = process.env.REPO || process.cwd();

const US = '\x1f';
const RS = '\x1e';

function git(repo, args, { maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repo, ...args], { maxBuffer }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || '');
        return reject(err);
      }
      resolve(String(stdout));
    });
  });
}

async function isRepo(repo) {
  try {
    const out = await git(repo, ['rev-parse', '--is-inside-work-tree']);
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

async function apiRepo(repo) {
  const [toplevel, branch, head] = await Promise.all([
    git(repo, ['rev-parse', '--show-toplevel']).then((s) => s.trim()).catch(() => repo),
    git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).then((s) => s.trim()).catch(() => '(detached)'),
    git(repo, ['rev-parse', 'HEAD']).then((s) => s.trim()).catch(() => null),
  ]);
  return { path: toplevel, name: path.basename(toplevel), currentBranch: branch, head };
}

async function apiRefs(repo) {
  const raw = await git(repo, [
    'for-each-ref',
    '--format=%(objectname)' + US + '%(refname)' + US + '%(refname:short)' + US + '%(HEAD)',
    'refs/heads', 'refs/remotes', 'refs/tags',
  ]).catch(() => '');
  const refs = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const [oid, refname, short, headMark] = line.split(US);
    let type = 'tag';
    if (refname.startsWith('refs/heads/')) type = 'local';
    else if (refname.startsWith('refs/remotes/')) type = 'remote';
    refs.push({ oid, refname, short, type, isHead: headMark === '*' });
  }
  return refs;
}

async function apiCommits(repo, limit) {
  const fmt = ['%H', '%P', '%an', '%ae', '%aI', '%s'].join(US) + RS;
  const raw = await git(repo, [
    'log', '--all', '--topo-order', '--date-order',
    `--max-count=${limit}`, `--pretty=format:${fmt}`,
  ]).catch((e) => {
    if ((e.stderr || '').includes('does not have any commits')) return '';
    throw e;
  });
  const commits = [];
  for (const rec of raw.split(RS)) {
    const line = rec.replace(/^\n/, '');
    if (!line.trim()) continue;
    const [hash, parents, an, ae, aI, s] = line.split(US);
    commits.push({
      hash,
      parents: parents ? parents.trim().split(/\s+/).filter(Boolean) : [],
      author: an,
      email: ae,
      date: aI,
      subject: s || '',
    });
  }
  return commits;
}

async function apiStatus(repo) {
  const raw = await git(repo, ['status', '--porcelain=v1', '-b']).catch(() => '');
  const lines = raw.split('\n').filter(Boolean);
  let branchLine = '';
  const files = [];
  for (const l of lines) {
    if (l.startsWith('## ')) { branchLine = l.slice(3); continue; }
    files.push({ xy: l.slice(0, 2), path: l.slice(3) });
  }
  return { branchLine, files, count: files.length };
}

async function apiCommit(repo, hash) {
  if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) throw new Error('bad hash');
  const fmt = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%cI', '%s', '%b'].join(US);
  const meta = (await git(repo, ['show', '-s', `--pretty=format:${fmt}`, hash])).split(US);
  const stat = await git(repo, ['show', '--stat', '--oneline', '--no-color', hash]).catch(() => '');
  return {
    hash: meta[0], parents: (meta[1] || '').trim().split(/\s+/).filter(Boolean),
    author: meta[2], email: meta[3], authorDate: meta[4],
    committer: meta[5], commitDate: meta[6],
    subject: meta[7], body: meta[8] || '',
    stat: stat.split('\n').slice(1).join('\n').trim(),
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function createHandler({ defaultRepo }) {
  return async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const p = u.pathname;
    if (!p.startsWith('/api/')) return serveStatic(req, res, p);

    const repo = u.searchParams.get('repo') || defaultRepo;
    try {
      if (p === '/api/health') return sendJSON(res, 200, { ok: true });
      if (!repo) return sendJSON(res, 400, { error: 'no repo selected' });
      if (!(await isRepo(repo))) return sendJSON(res, 400, { error: `not a git repo: ${repo}` });

      if (p === '/api/repo') return sendJSON(res, 200, await apiRepo(repo));
      if (p === '/api/refs') return sendJSON(res, 200, await apiRefs(repo));
      if (p === '/api/status') return sendJSON(res, 200, await apiStatus(repo));
      if (p === '/api/commits') {
        const limit = Math.min(Number(u.searchParams.get('limit')) || 300, 2000);
        return sendJSON(res, 200, await apiCommits(repo, limit));
      }
      if (p === '/api/commit') {
        return sendJSON(res, 200, await apiCommit(repo, u.searchParams.get('hash') || ''));
      }
      return sendJSON(res, 404, { error: 'unknown endpoint' });
    } catch (e) {
      return sendJSON(res, 500, { error: e.message, stderr: e.stderr });
    }
  };
}

/**
 * Start the HTTP server on 127.0.0.1.
 * @param {object} [opts]
 * @param {number} [opts.port=0]  0 lets the OS pick a free port.
 * @param {string|null} [opts.defaultRepo]  Repo used when a request has no ?repo=.
 *   Defaults to $REPO or cwd; pass null to require ?repo= on every API call.
 * @returns {Promise<{ port: number, url: string, server: http.Server, close: () => Promise<void> }>}
 */
function start({ port = 0, defaultRepo = DEFAULT_REPO } = {}) {
  const server = http.createServer(createHandler({ defaultRepo }));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const actual = server.address().port;
      resolve({
        port: actual,
        url: `http://127.0.0.1:${actual}`,
        server,
        close: () => new Promise((done) => {
          server.close(() => done());
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        }),
      });
    });
  });
}

module.exports = { start, createHandler, apiRepo, apiRefs, apiCommits, apiStatus, apiCommit, isRepo };

if (require.main === module) {
  start({ port: PORT, defaultRepo: DEFAULT_REPO }).then(({ url }) => {
    console.log(`[Gitdonaldo] git engine ready -> ${url}`);
    console.log(`[Gitdonaldo] default repo: ${DEFAULT_REPO}`);
  }).catch((e) => {
    console.error(`[Gitdonaldo] failed to start: ${e.code === 'EADDRINUSE' ? `port ${PORT} is already in use` : e.message}`);
    process.exit(1);
  });
}
