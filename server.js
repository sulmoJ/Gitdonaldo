#!/usr/bin/env node
'use strict';

const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 4317;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_REPO = process.env.REPO || process.cwd();

const US = '\x1f';
const RS = '\x1e';

const TIMEOUT_LOCAL = 30 * 1000;
const TIMEOUT_NETWORK = 120 * 1000;
const CONFIRM_TTL = 5 * 60 * 1000;
const MAX_BODY = 1024 * 1024;

// ---- M0: error model ---------------------------------------------------------------------

/** Error carried to the client as `{ error, code, ...extra }` with the given HTTP status. */
class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const badRequest = (msg, extra) => new ApiError(400, 'BAD_REQUEST', msg, extra);

/** Hide credentials that git may echo back in stderr (remote URLs, tokens). */
function maskSecrets(s) {
  return String(s || '')
    .replace(/x-access-token:[^@\s]+@/gi, 'x-access-token:***@')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1***:***@')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+@/gi, '$1***@')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,})\b/g, '***')
    .replace(/(authorization:\s*(?:basic|bearer)\s+)\S+/gi, '$1***');
}

// ---- M0: git runner ----------------------------------------------------------------------

// Never let git block on an interactive prompt or editor. Credentials stay with the user's
// credential helper / ssh-agent; this process never stores or asks for them.
const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no',
  GIT_PAGER: 'cat',
  LC_ALL: 'C',
  LANGUAGE: 'C',
};

/**
 * Run git with an argument array (no shell). Resolves `{ stdout, stderr }`.
 * Rejects with an Error carrying `stderr` (masked), `exitCode` and `timedOut`.
 * @param {string} repo
 * @param {string[]} args
 * @param {{ input?: string, timeout?: number, maxBuffer?: number }} [opts]
 */
function gitRun(repo, args, { input, timeout = TIMEOUT_LOCAL, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['-C', repo, ...args], {
      maxBuffer, timeout, killSignal: 'SIGTERM', env: { ...process.env, ...GIT_ENV },
    }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(`git ${args[0] === '--literal-pathspecs' ? args[1] : args[0]} failed`);
        e.stderr = maskSecrets(stderr);
        e.stdout = String(stdout || '');
        e.exitCode = typeof err.code === 'number' ? err.code : null;
        e.timedOut = Boolean(err.killed && err.signal);
        return reject(e);
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input == null ? '' : input);
  });
}

function git(repo, args, opts) {
  return gitRun(repo, args, opts).then((r) => r.stdout);
}

async function isRepo(repo) {
  try {
    const out = await git(repo, ['rev-parse', '--is-inside-work-tree']);
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

async function toplevel(repo) {
  return (await git(repo, ['rev-parse', '--show-toplevel'])).trim();
}

// ---- M0: per-repo lock -------------------------------------------------------------------

const locks = new Map();

/** Serialize writes per repository: fn runs after every earlier fn for the same key settles. */
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return run;
}

// ---- reads -------------------------------------------------------------------------------

async function apiRepo(repo) {
  const [top, branch, head] = await Promise.all([
    git(repo, ['rev-parse', '--show-toplevel']).then((s) => s.trim()).catch(() => repo),
    git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then((s) => s.trim()).catch(() => '(detached)'),
    git(repo, ['rev-parse', '--verify', '--quiet', 'HEAD']).then((s) => s.trim() || null).catch(() => null),
  ]);
  return { path: top, name: path.basename(top), currentBranch: branch, head };
}

async function apiRefs(repo) {
  const raw = await git(repo, [
    'for-each-ref',
    '--format=%(objectname)' + US + '%(refname)' + US + '%(refname:short)' + US + '%(HEAD)' + US + '%(*objectname)' + US + '%(upstream:short)',
    'refs/heads', 'refs/remotes', 'refs/tags',
  ]).catch(() => '');
  const refs = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const [oid, refname, short, headMark, peeled, upstream] = line.split(US);
    let type = 'tag';
    if (refname.startsWith('refs/heads/')) type = 'local';
    else if (refname.startsWith('refs/remotes/')) type = 'remote';
    const ref = { oid, refname, short, type, isHead: headMark === '*' };
    if (peeled) ref.target = peeled;
    if (upstream) ref.upstream = upstream;
    refs.push(ref);
  }
  return refs;
}

async function apiCommits(repo, limit) {
  const fmt = ['%H', '%P', '%an', '%ae', '%aI', '%s'].join(US) + RS;
  const raw = await git(repo, [
    'log', '--all', '--date-order',
    `--max-count=${limit}`, `--pretty=format:${fmt}`,
  ]).catch((e) => {
    if (/does not have any commits|unknown revision/.test(e.stderr || '')) return '';
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

const CONFLICT_XY = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function parseStatusZ(raw) {
  const parts = raw.split('\0');
  let branchLine = '';
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    if (rec.startsWith('## ')) { branchLine = rec.slice(3); continue; }
    const xy = rec.slice(0, 2);
    const file = { xy, path: rec.slice(3) };
    if (xy[0] === 'R' || xy[0] === 'C') file.origPath = parts[++i];
    file.conflicted = CONFLICT_XY.has(xy);
    file.untracked = xy === '??';
    file.staged = !file.conflicted && !file.untracked && xy[0] !== ' ' && xy[0] !== '!';
    file.unstaged = file.untracked || file.conflicted || (xy[1] !== ' ' && xy[1] !== '!');
    files.push(file);
  }
  return { branchLine, files, count: files.length };
}

async function apiStatus(repo) {
  const raw = await git(repo, ['status', '--porcelain=v1', '-z', '-b', '--untracked-files=all']).catch(() => '');
  return parseStatusZ(raw);
}

async function apiCommit(repo, hash) {
  if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) throw badRequest('bad hash');
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

async function apiAheadBehind(repo) {
  const upstream = await git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    .then((s) => s.trim()).catch(() => null);
  if (!upstream) return { ahead: 0, behind: 0, noUpstream: true };
  const out = await git(repo, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']).catch(() => '0\t0');
  const [ahead, behind] = out.trim().split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0, upstream };
}

async function gitDir(repo) {
  const d = (await git(repo, ['rev-parse', '--absolute-git-dir'])).trim();
  return d;
}

async function apiOpState(repo) {
  const dir = await gitDir(repo).catch(() => null);
  let op = null;
  if (dir) {
    const has = (f) => fs.existsSync(path.join(dir, f));
    if (has('rebase-merge') || has('rebase-apply')) op = 'rebase';
    else if (has('MERGE_HEAD')) op = 'merge';
    else if (has('CHERRY_PICK_HEAD')) op = 'cherry-pick';
    else if (has('REVERT_HEAD')) op = 'revert';
  }
  const conflicts = (await git(repo, ['diff', '--name-only', '-z', '--diff-filter=U']).catch(() => ''))
    .split('\0').filter(Boolean);
  return { op, conflicts };
}

async function apiStashes(repo) {
  const raw = await git(repo, ['stash', 'list', `--format=%gd${US}%H${US}%gs${US}%cI`]).catch(() => '');
  return raw.split('\n').filter(Boolean).map((line, index) => {
    const [ref, hash, message, date] = line.split(US);
    return { index, ref, hash, message, date };
  });
}

async function apiRemotes(repo) {
  const raw = await git(repo, ['remote']).catch(() => '');
  return raw.split('\n').filter(Boolean);
}

/** State returned with every successful write so the client can refresh without guessing. */
async function snapshot(repo) {
  const [info, status, refs, opState, aheadBehind, stashes] = await Promise.all([
    apiRepo(repo), apiStatus(repo), apiRefs(repo), apiOpState(repo), apiAheadBehind(repo), apiStashes(repo),
  ]);
  return { repo: info, status, refs, opState, aheadBehind, stashes };
}

// ---- M0: confirm tokens (two-step destructive operations) --------------------------------

const CONFIRM_SECRET = crypto.randomBytes(32);

/** sha256(HEAD + status --porcelain + show-ref): any change to what the user saw invalidates the token. */
async function stateHash(repo) {
  const [head, status, refs] = await Promise.all([
    git(repo, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => ''),
    git(repo, ['status', '--porcelain', '-z', '--untracked-files=all']).catch(() => ''),
    git(repo, ['show-ref']).catch(() => ''),
  ]);
  return crypto.createHash('sha256').update(head).update('\0').update(status).update('\0').update(refs).digest('hex');
}

function confirmSig(op, repoTop, params, hash, exp) {
  return crypto.createHmac('sha256', CONFIRM_SECRET)
    .update(JSON.stringify([op, repoTop, params, hash, exp])).digest('base64url');
}

async function issueConfirm(op, repoTop, params) {
  const exp = Date.now() + CONFIRM_TTL;
  return `${exp}.${confirmSig(op, repoTop, params, await stateHash(repoTop), exp)}`;
}

/**
 * Gate for destructive operations. Without a token: throws 428 CONFIRM_REQUIRED carrying a fresh
 * token and the dialog contents. With a token: verifies op/params/repo state still match.
 */
async function requireConfirm(ctx, op, params, confirm) {
  const { body, repoTop } = ctx;
  const token = body.confirmToken;
  if (!token) {
    throw new ApiError(428, 'CONFIRM_REQUIRED', confirm.title, {
      confirmToken: await issueConfirm(op, repoTop, params),
      confirm: { risk: 'medium', ...confirm },
    });
  }
  const m = /^(\d+)\.([A-Za-z0-9_-]+)$/.exec(String(token));
  if (!m) throw new ApiError(409, 'CONFIRM_INVALID', '확인 토큰이 올바르지 않습니다. 다시 시도하세요.');
  const exp = Number(m[1]);
  if (Date.now() > exp) throw new ApiError(409, 'CONFIRM_EXPIRED', '확인 시간이 지났습니다. 다시 시도하세요.');
  const expected = confirmSig(op, repoTop, params, await stateHash(repoTop), exp);
  if (!safeEqual(expected, m[2])) {
    throw new ApiError(409, 'CONFIRM_INVALID', '확인 이후 저장소 상태가 바뀌었거나 토큰이 맞지 않습니다. 다시 확인하세요.');
  }
  if (confirm.typed && body.confirmText !== 'CONFIRM') {
    throw new ApiError(400, 'CONFIRM_TEXT_REQUIRED', '확인을 위해 CONFIRM을 입력하세요.');
  }
}

// ---- validation helpers ------------------------------------------------------------------

function str(v, name, { required = true, max = 4096 } = {}) {
  if (v == null || v === '') {
    if (required) throw badRequest(`${name} is required`);
    return null;
  }
  if (typeof v !== 'string' || v.length > max || v.includes('\0')) throw badRequest(`invalid ${name}`);
  return v;
}

function pathList(v) {
  if (v == null) return null;
  if (!Array.isArray(v) || v.length === 0 || v.length > 10000) throw badRequest('paths must be a non-empty array');
  return v.map((p) => str(p, 'path'));
}

/** A ref/revision name the user typed. Rejects option-looking values; git validates the rest. */
function revName(v, name) {
  const s = str(v, name, { max: 1024 });
  if (s.startsWith('-') || /[\s\x00-\x1f\x7f]/.test(s)) throw badRequest(`invalid ${name}`);
  return s;
}

async function validBranchName(repo, name) {
  const s = str(name, 'name', { max: 255 });
  if (s.startsWith('-')) throw badRequest('invalid branch name');
  await git(repo, ['check-ref-format', '--branch', s]).catch(() => { throw badRequest(`invalid branch name: ${s}`); });
  return s;
}

async function validTagName(repo, name) {
  const s = str(name, 'name', { max: 255 });
  if (s.startsWith('-')) throw badRequest('invalid tag name');
  await git(repo, ['check-ref-format', `refs/tags/${s}`]).catch(() => { throw badRequest(`invalid tag name: ${s}`); });
  return s;
}

async function resolveCommit(repo, rev) {
  const r = revName(rev, 'ref');
  const out = await git(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${r}^{commit}`]).catch(() => '');
  if (!out.trim()) throw badRequest(`unknown revision: ${r}`);
  return out.trim();
}

async function refExists(repo, refname) {
  return git(repo, ['show-ref', '--verify', '--quiet', refname]).then(() => true, () => false);
}

function stashRef(index) {
  if (!Number.isInteger(index) || index < 0 || index > 100000) throw badRequest('invalid stash index');
  return `stash@{${index}}`;
}

/** Block operations that need a clean tree (checkout, merge, revert, cherry-pick). Untracked files are allowed. */
async function requireClean(repo, what) {
  const st = await apiStatus(repo);
  const dirty = st.files.filter((f) => !f.untracked);
  if (dirty.length) {
    throw new ApiError(409, 'DIRTY_WORKTREE',
      `커밋하지 않은 변경 ${dirty.length}개가 있어 ${what}할 수 없습니다. 커밋하거나 stash 하세요.`,
      { files: dirty.map((f) => f.path).slice(0, 50) });
  }
}

async function requireNoOp(repo) {
  const st = await apiOpState(repo);
  if (st.op) {
    throw new ApiError(409, 'OP_IN_PROGRESS', `${st.op} 작업이 진행 중입니다. 먼저 계속하거나 중단하세요.`, { opState: st });
  }
}

// ---- git failure → ApiError --------------------------------------------------------------

function isConflict(e) {
  return /CONFLICT|Automatic merge failed|could not apply|after resolving the conflicts|needs merge/i
    .test(`${e.stdout || ''}\n${e.stderr || ''}`);
}

function gitFailure(e, fallbackMsg) {
  if (e instanceof ApiError) return e;
  const stderr = e.stderr || '';
  if (e.timedOut) return new ApiError(504, 'TIMEOUT', 'git 명령이 시간 안에 끝나지 않았습니다.', { stderr });
  if (/Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied \(publickey|invalid credentials|HTTP Basic: Access denied/i.test(stderr)) {
    return new ApiError(401, 'AUTH_REQUIRED',
      '원격 인증에 실패했습니다. git credential helper 또는 ssh-agent를 설정하세요(Gitdonaldo는 자격증명을 저장하지 않습니다).', { stderr });
  }
  if (/Could not resolve host|Connection refused|Connection timed out|unable to access|Could not read from remote repository|does not appear to be a git repository/i.test(stderr)) {
    return new ApiError(502, 'REMOTE_UNREACHABLE', '원격 저장소에 연결하지 못했습니다.', { stderr });
  }
  return new ApiError(500, 'GIT_FAILED', fallbackMsg || e.message, { stderr });
}

/** Run a command that may stop on conflicts (merge, revert, cherry-pick, stash apply, pull). */
async function runMayConflict(repo, args, opMsg, opts) {
  try {
    return await gitRun(repo, args, opts);
  } catch (e) {
    if (!e.timedOut && isConflict(e)) {
      throw new ApiError(409, 'CONFLICT', `${opMsg} 중 충돌이 발생했습니다. 충돌을 해결한 뒤 계속하거나 중단하세요.`, {
        stderr: e.stderr, opState: await apiOpState(repo), snapshot: await snapshot(repo),
      });
    }
    throw gitFailure(e, `${opMsg}에 실패했습니다.`);
  }
}

// ---- writes (M1: working area & commit) --------------------------------------------------

async function opStage(repo, body) {
  const paths = pathList(body.paths);
  if (paths) await git(repo, ['--literal-pathspecs', 'add', '-A', '--', ...paths]);
  else if (body.all) await git(repo, ['add', '-A']);
  else throw badRequest('paths or all is required');
}

async function opUnstage(repo, body) {
  const paths = pathList(body.paths);
  if (!paths && !body.all) throw badRequest('paths or all is required');
  const hasHead = Boolean((await git(repo, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => '')).trim());
  if (hasHead) {
    await git(repo, paths ? ['--literal-pathspecs', 'reset', '-q', 'HEAD', '--', ...paths] : ['reset', '-q', 'HEAD']);
  } else {
    // Before the first commit there is no HEAD to reset to: drop entries from the index instead.
    await git(repo, paths
      ? ['--literal-pathspecs', 'rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', ...paths]
      : ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', '.']);
  }
}

async function opDiscard(ctx) {
  const { repo, body } = ctx;
  const paths = pathList(body.paths);
  if (!paths && !body.all) throw badRequest('paths or all is required');
  const st = await apiStatus(repo);
  const pick = paths ? st.files.filter((f) => paths.includes(f.path)) : st.files;
  const targets = pick.filter((f) => f.unstaged && !f.conflicted);
  if (!targets.length) throw new ApiError(422, 'PRECHECK_FAILED', '되돌릴 작업 트리 변경이 없습니다.');
  const untracked = targets.filter((f) => f.untracked).map((f) => f.path);
  const tracked = targets.filter((f) => !f.untracked).map((f) => f.path);

  await requireConfirm(ctx, 'discard', { paths: paths || null, all: Boolean(body.all) }, {
    title: '변경 사항 버리기',
    message: `작업 트리 변경 ${targets.length}개를 되돌립니다. 새 파일은 삭제됩니다. 되돌릴 수 없습니다.`,
    details: targets.map((f) => `${f.xy} ${f.path}`).slice(0, 100),
    action: '버리기',
  });

  if (tracked.length) await git(repo, ['--literal-pathspecs', 'checkout', '--', ...tracked]);
  if (untracked.length) await git(repo, ['--literal-pathspecs', 'clean', '-f', '-q', '--', ...untracked]);
  return { discarded: targets.length };
}

const TRAILER_RE = /^[^<>\n\r]{1,200} <[^<>\s@]+@[^<>\s]+>$/;

function coAuthorTrailers(v) {
  if (v == null || v === '') return [];
  const list = Array.isArray(v) ? v : String(v).split(/[\n,]+/);
  return list.map((x) => {
    const s = typeof x === 'object' && x ? `${String(x.name || '').trim()} <${String(x.email || '').trim()}>` : String(x).trim();
    return s;
  }).filter(Boolean).map((s) => {
    if (!TRAILER_RE.test(s)) throw badRequest(`co-author must look like "Name <email>": ${s}`);
    return `Co-authored-by: ${s}`;
  });
}

async function opCommit(repo, body) {
  const amend = Boolean(body.amend);
  const message = String(body.message == null ? '' : body.message).replace(/\r\n/g, '\n');
  if (message.includes('\0') || message.length > 100000) throw badRequest('invalid message');
  const trailers = coAuthorTrailers(body.coAuthors);

  const [st, op, ident, head] = await Promise.all([
    apiStatus(repo), apiOpState(repo),
    git(repo, ['var', 'GIT_COMMITTER_IDENT']).then(() => true, () => false),
    git(repo, ['rev-parse', '--verify', '--quiet', 'HEAD']).then((s) => s.trim(), () => ''),
  ]);
  const problems = [];
  if (!message.trim()) problems.push({ check: 'message', message: '커밋 메시지를 입력하세요.' });
  if (!ident) problems.push({ check: 'identity', message: 'git user.name / user.email 이 설정되지 않았습니다.' });
  if (op.conflicts.length) problems.push({ check: 'conflicts', message: `충돌이 해결되지 않은 파일 ${op.conflicts.length}개가 있습니다.` });
  if (amend && !head) problems.push({ check: 'amend', message: '수정할 이전 커밋이 없습니다.' });
  if (!amend && !body.allowEmpty && !op.op && !st.files.some((f) => f.staged)) {
    problems.push({ check: 'staged', message: '스테이징된 변경이 없습니다.' });
  }
  if (problems.length) {
    throw new ApiError(422, 'PRECHECK_FAILED', problems.map((p) => p.message).join(' '), { problems });
  }

  let full = message.trim();
  if (trailers.length) {
    const existing = new Set(full.split('\n').map((l) => l.trim()));
    const add = trailers.filter((t) => !existing.has(t));
    if (add.length) full += (/\n[A-Za-z-]+: .+$/.test(full) ? '\n' : '\n\n') + add.join('\n');
  }
  const args = ['commit', '-q', '--cleanup=strip', '-F', '-'];
  if (amend) args.push('--amend');
  if (body.allowEmpty) args.push('--allow-empty');
  try {
    await gitRun(repo, args, { input: full + '\n' });
  } catch (e) {
    throw gitFailure(e, '커밋에 실패했습니다.');
  }
  return { hash: (await git(repo, ['rev-parse', 'HEAD'])).trim() };
}

// ---- writes (M2: branches, history) ------------------------------------------------------

async function opBranchCreate(repo, body) {
  const name = await validBranchName(repo, body.name);
  if (await refExists(repo, `refs/heads/${name}`)) throw new ApiError(409, 'ALREADY_EXISTS', `브랜치 ${name}이(가) 이미 있습니다.`);
  const start = body.start ? await resolveCommit(repo, body.start) : null;
  if (body.checkout) {
    await requireClean(repo, '브랜치를 전환');
    await git(repo, ['checkout', '-q', '-b', name, ...(start ? [start] : [])]);
  } else {
    await git(repo, ['branch', name, ...(start ? [start] : [])]);
  }
  return { name };
}

async function opBranchDelete(ctx) {
  const { repo, body } = ctx;
  const name = await validBranchName(repo, body.name);
  if (!(await refExists(repo, `refs/heads/${name}`))) throw badRequest(`no such branch: ${name}`);
  const current = await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then((s) => s.trim(), () => '');
  if (current === name) throw new ApiError(409, 'PRECHECK_FAILED', '현재 체크아웃된 브랜치는 삭제할 수 없습니다.');
  // "Merged" = reachable from its upstream if it has one, otherwise from HEAD (git branch -d semantics).
  const upstream = await git(repo, ['rev-parse', '--abbrev-ref', `${name}@{u}`]).then((s) => s.trim(), () => '');
  const base = upstream || 'HEAD';
  const merged = await git(repo, ['merge-base', '--is-ancestor', `refs/heads/${name}`, base]).then(() => true, () => false);
  await requireConfirm(ctx, 'branch-delete', { name }, merged ? {
    title: `브랜치 ${name} 삭제`,
    message: `${base}에 병합된 브랜치입니다. 삭제합니다.`,
    action: '삭제',
  } : {
    title: `병합되지 않은 브랜치 ${name} 삭제`,
    message: `${base}에 병합되지 않은 커밋이 있습니다. 삭제하면 그 커밋을 잃을 수 있습니다.`,
    risk: 'high', typed: true, action: '강제 삭제',
  });
  await git(repo, ['branch', merged ? '-d' : '-D', '--', name]).catch((e) => { throw gitFailure(e, '브랜치 삭제에 실패했습니다.'); });
  return { name, merged };
}

async function opCheckout(repo, body) {
  const ref = revName(body.ref, 'ref');
  await requireNoOp(repo);
  await requireClean(repo, '체크아웃');
  const run = (args) => git(repo, args).catch((e) => { throw gitFailure(e, '체크아웃에 실패했습니다.'); });

  if (body.detach) {
    const oid = await resolveCommit(repo, ref);
    await run(['checkout', '-q', '--detach', oid]);
    return { detached: oid };
  }
  if (await refExists(repo, `refs/heads/${ref}`)) {
    await run(['checkout', '-q', ref, '--']);
    return { branch: ref };
  }
  if (await refExists(repo, `refs/remotes/${ref}`)) {
    const local = ref.split('/').slice(1).join('/');
    if (await refExists(repo, `refs/heads/${local}`)) {
      await run(['checkout', '-q', local, '--']);
      return { branch: local };
    }
    await validBranchName(repo, local);
    await run(['checkout', '-q', '-b', local, '--track', `refs/remotes/${ref}`]);
    return { branch: local, tracking: ref };
  }
  const oid = await resolveCommit(repo, ref);
  await run(['checkout', '-q', '--detach', oid]);
  return { detached: oid };
}

async function opMerge(repo, body) {
  const ref = revName(body.ref, 'ref');
  await resolveCommit(repo, ref);
  await requireNoOp(repo);
  await requireClean(repo, '머지');
  const args = ['merge', '--no-edit'];
  if (body.ffOnly) args.push('--ff-only');
  else if (body.noFF) args.push('--no-ff');
  args.push('--end-of-options', ref);
  const r = await runMayConflict(repo, args, '머지');
  return { fastForward: /Fast-forward/.test(r.stdout), upToDate: /Already up to date/i.test(r.stdout) };
}

async function opAbort(repo) {
  const { op } = await apiOpState(repo);
  if (!op) throw new ApiError(409, 'PRECHECK_FAILED', '진행 중인 작업이 없습니다.');
  await git(repo, [op, '--abort']).catch((e) => { throw gitFailure(e, `${op} 중단에 실패했습니다.`); });
  return { aborted: op };
}

async function opContinue(repo) {
  const st = await apiOpState(repo);
  if (!st.op) throw new ApiError(409, 'PRECHECK_FAILED', '진행 중인 작업이 없습니다.');
  if (st.conflicts.length) {
    throw new ApiError(422, 'PRECHECK_FAILED', `충돌이 해결되지 않은 파일 ${st.conflicts.length}개가 있습니다. 해결 후 스테이징하세요.`, { opState: st });
  }
  const args = st.op === 'merge' ? ['commit', '--no-edit'] : [st.op, '--continue'];
  await runMayConflict(repo, args, st.op);
  return { continued: st.op };
}

async function opReset(ctx) {
  const { repo, body } = ctx;
  const mode = body.mode || 'mixed';
  if (!['soft', 'mixed', 'hard'].includes(mode)) throw badRequest('mode must be soft, mixed or hard');
  const target = await resolveCommit(repo, body.target || 'HEAD');
  await requireNoOp(repo);
  if (mode === 'hard') {
    const st = await apiStatus(repo);
    const changed = st.files.filter((f) => !f.untracked);
    await requireConfirm(ctx, 'reset-hard', { target }, {
      title: `HEAD를 ${target.slice(0, 7)}(으)로 hard reset`,
      message: `작업 트리와 인덱스의 변경 ${changed.length}개가 사라지고, 대상 이후 커밋은 브랜치에서 빠집니다. 되돌리기 어렵습니다.`,
      details: changed.map((f) => `${f.xy} ${f.path}`).slice(0, 100),
      risk: 'high', typed: true, action: 'Hard reset',
    });
  }
  await git(repo, ['reset', '-q', `--${mode}`, target]).catch((e) => { throw gitFailure(e, 'reset에 실패했습니다.'); });
  return { mode, target };
}

async function pickLike(repo, body, op, label) {
  const oid = await resolveCommit(repo, body.hash);
  await requireNoOp(repo);
  await requireClean(repo, label);
  const parents = (await git(repo, ['rev-list', '--parents', '-n', '1', oid])).trim().split(/\s+/).slice(1);
  const args = [op];
  if (op === 'revert') args.push('--no-edit');
  if (parents.length > 1) args.push('-m', String(Number.isInteger(body.mainline) && body.mainline > 0 ? body.mainline : 1));
  args.push(oid);
  await runMayConflict(repo, args, label);
  return { hash: (await git(repo, ['rev-parse', 'HEAD'])).trim() };
}

// ---- writes (M3: tags, stash, remotes) ---------------------------------------------------

async function opTagCreate(repo, body) {
  const name = await validTagName(repo, body.name);
  if (await refExists(repo, `refs/tags/${name}`)) throw new ApiError(409, 'ALREADY_EXISTS', `태그 ${name}이(가) 이미 있습니다.`);
  const target = await resolveCommit(repo, body.target || 'HEAD');
  const message = str(body.message, 'message', { required: false, max: 100000 });
  if (message && message.trim()) {
    await gitRun(repo, ['tag', '-a', '-F', '-', name, target], { input: message.trim() + '\n' })
      .catch((e) => { throw gitFailure(e, '태그 생성에 실패했습니다.'); });
  } else {
    await git(repo, ['tag', name, target]);
  }
  return { name, annotated: Boolean(message && message.trim()) };
}

async function opTagDelete(ctx) {
  const { repo, body } = ctx;
  const name = await validTagName(repo, body.name);
  if (!(await refExists(repo, `refs/tags/${name}`))) throw badRequest(`no such tag: ${name}`);
  await requireConfirm(ctx, 'tag-delete', { name }, {
    title: `태그 ${name} 삭제`,
    message: '로컬 태그를 삭제합니다. 원격에 올라간 태그는 지워지지 않습니다.',
    action: '삭제',
  });
  await git(repo, ['tag', '-d', name]);
  return { name };
}

async function opStashPush(repo, body) {
  const st = await apiStatus(repo);
  const includeUntracked = Boolean(body.includeUntracked);
  if (!st.files.some((f) => includeUntracked || !f.untracked)) {
    throw new ApiError(422, 'PRECHECK_FAILED', 'stash 할 변경이 없습니다.');
  }
  const args = ['stash', 'push', '-q'];
  if (includeUntracked) args.push('--include-untracked');
  const message = str(body.message, 'message', { required: false, max: 1000 });
  if (message) args.push('-m', message.replace(/\n/g, ' '));
  await git(repo, args).catch((e) => { throw gitFailure(e, 'stash에 실패했습니다.'); });
}

async function opStashApply(repo, body, pop) {
  const ref = stashRef(body.index);
  if (!(await git(repo, ['rev-parse', '--verify', '--quiet', ref]).catch(() => '')).trim()) throw badRequest(`no such stash: ${ref}`);
  await runMayConflict(repo, ['stash', pop ? 'pop' : 'apply', '-q', ref], pop ? 'stash pop' : 'stash apply');
}

async function opStashDrop(ctx) {
  const { repo, body } = ctx;
  const ref = stashRef(body.index);
  const list = await apiStashes(repo);
  const entry = list[body.index];
  if (!entry) throw badRequest(`no such stash: ${ref}`);
  await requireConfirm(ctx, 'stash-drop', { index: body.index, hash: entry.hash }, {
    title: `${ref} 삭제`,
    message: `"${entry.message}" stash를 삭제합니다. 되돌릴 수 없습니다.`,
    action: '삭제',
  });
  await git(repo, ['stash', 'drop', '-q', ref]);
}

async function remoteName(repo, v) {
  const remotes = await apiRemotes(repo);
  if (!remotes.length) throw new ApiError(422, 'PRECHECK_FAILED', '설정된 원격 저장소가 없습니다.');
  if (v == null || v === '') return remotes.includes('origin') ? 'origin' : remotes[0];
  const r = str(v, 'remote', { max: 255 });
  if (!remotes.includes(r)) throw badRequest(`unknown remote: ${r}`);
  return r;
}

async function opFetch(repo, body) {
  const args = ['fetch', '--prune'];
  if (body.all) args.push('--all');
  else args.push(await remoteName(repo, body.remote));
  await gitRun(repo, args, { timeout: TIMEOUT_NETWORK }).catch((e) => { throw gitFailure(e, 'fetch에 실패했습니다.'); });
}

async function opPull(repo, body) {
  await requireNoOp(repo);
  const ab = await apiAheadBehind(repo);
  if (ab.noUpstream) throw new ApiError(422, 'NO_UPSTREAM', '현재 브랜치에 upstream이 없어 pull 할 수 없습니다.');
  const args = ['pull', body.ffOnly ? '--ff-only' : '--no-rebase', '--no-edit'];
  await runMayConflict(repo, args, 'pull', { timeout: TIMEOUT_NETWORK });
}

async function opPush(ctx) {
  const { repo, body } = ctx;
  const branch = await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then((s) => s.trim(), () => '');
  if (!branch) throw new ApiError(422, 'PRECHECK_FAILED', 'detached HEAD 상태에서는 push 할 수 없습니다.');
  const force = body.force || null; // null | 'lease' | 'force'
  if (force && !['lease', 'force'].includes(force)) throw badRequest('force must be "lease" or "force"');

  const ab = await apiAheadBehind(repo);
  const remote = ab.noUpstream || body.remote ? await remoteName(repo, body.remote) : ab.upstream.split('/')[0];
  const args = ['push', '--porcelain'];
  if (ab.noUpstream) args.push('--set-upstream');
  if (force === 'lease') args.push('--force-with-lease');
  if (force === 'force') args.push('--force');
  args.push(remote, `HEAD:refs/heads/${ab.noUpstream ? branch : ab.upstream.split('/').slice(1).join('/')}`);

  if (force) {
    const pure = force === 'force';
    if (pure && body.acknowledgeForce !== true && body.confirmToken) {
      throw new ApiError(400, 'FORCE_NOT_ACKNOWLEDGED', '순수 --force는 경고를 확인(체크)해야 실행할 수 있습니다.');
    }
    await requireConfirm(ctx, 'push-force', { remote, branch, force }, {
      title: pure ? `${remote}/${branch}에 --force push` : `${remote}/${branch}에 force push (--force-with-lease)`,
      message: pure
        ? '원격 브랜치를 내 로컬 상태로 무조건 덮어씁니다. 다른 사람이 올린 커밋도 사라질 수 있습니다.'
        : '원격 브랜치를 내 로컬 상태로 덮어씁니다. 마지막 fetch 이후 원격이 바뀌었다면 거부됩니다.',
      risk: 'high', typed: true, action: 'Force push',
      ...(pure ? { checkbox: '--force-with-lease 보호 없이 원격 커밋을 덮어쓸 수 있음을 이해합니다.' } : {}),
    });
  }
  try {
    await gitRun(repo, args, { timeout: TIMEOUT_NETWORK });
  } catch (e) {
    const out = `${e.stdout}\n${e.stderr}`;
    if (/\[rejected\]|non-fast-forward|fetch first|stale info|\(stale/i.test(out)) {
      throw new ApiError(409, 'PUSH_REJECTED',
        force === 'lease'
          ? '원격이 마지막 fetch 이후 바뀌어 --force-with-lease가 거부했습니다. fetch 후 다시 확인하세요.'
          : '원격에 내 로컬에 없는 커밋이 있어 push가 거부됐습니다. 먼저 pull 하세요.',
        { stderr: maskSecrets(out.trim()) });
    }
    throw gitFailure(e, 'push에 실패했습니다.');
  }
  return { remote, branch, setUpstream: Boolean(ab.noUpstream), force };
}

// ---- routing -----------------------------------------------------------------------------

// Each write: (ctx) => result. ctx = { repo, repoTop, body }.
const WRITES = {
  '/api/stage': (c) => opStage(c.repo, c.body),
  '/api/unstage': (c) => opUnstage(c.repo, c.body),
  '/api/discard': (c) => opDiscard(c),
  '/api/commit': (c) => opCommit(c.repo, c.body),
  '/api/branch': (c) => opBranchCreate(c.repo, c.body),
  '/api/branch/delete': (c) => opBranchDelete(c),
  '/api/checkout': (c) => opCheckout(c.repo, c.body),
  '/api/merge': (c) => opMerge(c.repo, c.body),
  '/api/op/abort': (c) => opAbort(c.repo),
  '/api/op/continue': (c) => opContinue(c.repo),
  '/api/reset': (c) => opReset(c),
  '/api/revert': (c) => pickLike(c.repo, c.body, 'revert', 'revert'),
  '/api/cherry-pick': (c) => pickLike(c.repo, c.body, 'cherry-pick', 'cherry-pick'),
  '/api/tag': (c) => opTagCreate(c.repo, c.body),
  '/api/tag/delete': (c) => opTagDelete(c),
  '/api/stash': (c) => opStashPush(c.repo, c.body),
  '/api/stash/apply': (c) => opStashApply(c.repo, c.body, false),
  '/api/stash/pop': (c) => opStashApply(c.repo, c.body, true),
  '/api/stash/drop': (c) => opStashDrop(c),
  '/api/fetch': (c) => opFetch(c.repo, c.body),
  '/api/pull': (c) => opPull(c.repo, c.body),
  '/api/push': (c) => opPush(c),
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

// Applied to every response. The UI uses no inline scripts or inline style attributes.
const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
    "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

const TOKEN_HEADER = 'x-gitdonaldo-token';

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function sendError(res, e) {
  if (e instanceof ApiError) return sendJSON(res, e.status, { error: e.message, code: e.code, ...e.extra });
  return sendJSON(res, 500, { error: e.message, code: 'INTERNAL', stderr: e.stderr ? maskSecrets(e.stderr) : undefined });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new ApiError(413, 'BAD_REQUEST', 'request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        const v = JSON.parse(text);
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch { reject(badRequest('body must be a JSON object')); }
    });
    req.on('error', reject);
  });
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

/**
 * @param {object} opts
 * @param {string|null} opts.defaultRepo
 * @param {string|null} [opts.token]  When set, every /api/* request must send it in the x-gitdonaldo-token header.
 * @param {() => Set<string>} [opts.allowedHosts]  Accepted Host header values (blocks DNS rebinding). Empty/absent = no check.
 */
function createHandler({ defaultRepo, token = null, allowedHosts = null }) {
  return async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

    const hosts = allowedHosts ? allowedHosts() : null;
    if (hosts && hosts.size && !hosts.has(String(req.headers.host || '').toLowerCase())) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('forbidden host');
    }

    const u = new URL(req.url, 'http://127.0.0.1');
    const p = u.pathname;
    if (!p.startsWith('/api/')) return serveStatic(req, res, p);

    if (token && !safeEqual(req.headers[TOKEN_HEADER], token)) {
      return sendJSON(res, 403, { error: 'forbidden' });
    }

    try {
      if (p === '/api/health') return sendJSON(res, 200, { ok: true });

      // /api/commit is both a read (GET: commit detail) and a write (POST: create commit).
      const READ_ALSO = p === '/api/commit';
      const write = WRITES[p] && (req.method === 'POST' || !READ_ALSO) ? WRITES[p] : null;
      let body = {};
      if (write) {
        if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'use POST');
        // A JSON content type forces a CORS preflight, which this server never answers:
        // other origins cannot trigger writes even in tokenless browser mode.
        if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
          throw new ApiError(415, 'BAD_REQUEST', 'content-type must be application/json');
        }
        body = await readBody(req);
      } else if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'use GET');
      }

      const repo = u.searchParams.get('repo') || (typeof body.repo === 'string' && body.repo) || defaultRepo;
      if (!repo) throw new ApiError(400, 'NO_REPO', 'no repo selected');
      if (!(await isRepo(repo))) throw new ApiError(400, 'NOT_A_REPO', `not a git repo: ${repo}`);

      if (write) {
        const repoTop = await toplevel(repo);
        const result = await withLock(repoTop, async () => {
          const ctx = { repo: repoTop, repoTop, body };
          return (await write(ctx)) || {};
        });
        return sendJSON(res, 200, { ok: true, result, snapshot: await snapshot(repoTop) });
      }

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
      if (p === '/api/ahead-behind') return sendJSON(res, 200, await apiAheadBehind(repo));
      if (p === '/api/op-state') return sendJSON(res, 200, await apiOpState(repo));
      if (p === '/api/stashes') return sendJSON(res, 200, await apiStashes(repo));
      if (p === '/api/remotes') return sendJSON(res, 200, await apiRemotes(repo));
      if (p === '/api/snapshot') return sendJSON(res, 200, await snapshot(repo));
      return sendJSON(res, 404, { error: 'unknown endpoint', code: 'NOT_FOUND' });
    } catch (e) {
      return sendError(res, e instanceof ApiError ? e : gitFailure(e));
    }
  };
}

/**
 * Start the HTTP server on 127.0.0.1.
 * @param {object} [opts]
 * @param {number} [opts.port=0]  0 lets the OS pick a free port.
 * @param {string|null} [opts.defaultRepo]  Repo used when a request has no ?repo=.
 *   Defaults to $REPO or cwd; pass null to require ?repo= on every API call.
 * @param {string|null} [opts.token]  Require this token on /api/* (header x-gitdonaldo-token).
 * @returns {Promise<{ port: number, url: string, server: http.Server, close: () => Promise<void> }>}
 */
function start({ port = 0, defaultRepo = DEFAULT_REPO, token = null } = {}) {
  const hosts = new Set();
  const server = http.createServer(createHandler({ defaultRepo, token, allowedHosts: () => hosts }));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const actual = server.address().port;
      hosts.add(`127.0.0.1:${actual}`);
      hosts.add(`localhost:${actual}`);
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

module.exports = {
  start, createHandler, TOKEN_HEADER, ApiError,
  apiRepo, apiRefs, apiCommits, apiStatus, apiCommit, apiAheadBehind, apiOpState, apiStashes, isRepo,
  gitRun, withLock, maskSecrets, stateHash, snapshot, parseStatusZ,
};

if (require.main === module) {
  start({ port: PORT, defaultRepo: DEFAULT_REPO }).then(({ url }) => {
    console.log(`[Gitdonaldo] git engine ready -> ${url}`);
    console.log(`[Gitdonaldo] default repo: ${DEFAULT_REPO}`);
  }).catch((e) => {
    console.error(`[Gitdonaldo] failed to start: ${e.code === 'EADDRINUSE' ? `port ${PORT} is already in use` : e.message}`);
    process.exit(1);
  });
}
