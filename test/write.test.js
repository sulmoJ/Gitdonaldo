'use strict';

// Write API (M0–M3): stage/commit, prechecks, two-step confirm tokens, branches, merge,
// reset, tags, stash, remotes, per-repo lock.

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start, maskSecrets, withLock, parseStatusZ } = require('../server.js');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function makeRepo({ commits = true } = {}) {
  const dir = tmp('gd-write-');
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' }).toString();
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Test');
  g('config', 'user.email', 'test@example.com');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'tag.gpgsign', 'false');
  if (commits) {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    g('add', '.');
    g('commit', '-q', '-m', 'first');
  }
  return { dir, g, write: (f, s) => fs.writeFileSync(path.join(dir, f), s), read: (f) => fs.readFileSync(path.join(dir, f), 'utf8') };
}

async function serve(t, repo) {
  const app = await start({ port: 0, defaultRepo: repo });
  t.after(() => app.close());
  const post = async (ep, body = {}) => {
    const r = await fetch(app.url + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const get = async (ep) => {
    const r = await fetch(app.url + ep);
    return { status: r.status, body: await r.json() };
  };
  // Two-step: first call gets 428 + token, second call sends it back.
  const confirmed = async (ep, body, extra = {}) => {
    const first = await post(ep, body);
    assert.strictEqual(first.status, 428, JSON.stringify(first.body));
    assert.strictEqual(first.body.code, 'CONFIRM_REQUIRED');
    return post(ep, { ...body, confirmToken: first.body.confirmToken, ...extra });
  };
  return { app, post, get, confirmed };
}

test('stage → commit updates status and returns a snapshot', async (t) => {
  const r = makeRepo();
  const { post } = await serve(t, r.dir);
  r.write('a.txt', 'two\n');
  r.write('b.txt', 'new\n');

  const st = await post('/api/stage', { paths: ['b.txt'] });
  assert.strictEqual(st.status, 200);
  const files = Object.fromEntries(st.body.snapshot.status.files.map((f) => [f.path, f]));
  assert.ok(files['b.txt'].staged && !files['b.txt'].unstaged);
  assert.ok(files['a.txt'].unstaged && !files['a.txt'].staged);

  const all = await post('/api/stage', { all: true });
  assert.ok(all.body.snapshot.status.files.every((f) => f.staged));

  const un = await post('/api/unstage', { paths: ['a.txt'] });
  assert.ok(un.body.snapshot.status.files.find((f) => f.path === 'a.txt').unstaged);

  const c = await post('/api/commit', { message: 'add b' });
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  assert.match(c.body.result.hash, /^[0-9a-f]{40}$/);
  assert.strictEqual(r.g('log', '-1', '--format=%s').trim(), 'add b');
  assert.deepStrictEqual(c.body.snapshot.status.files.map((f) => f.path), ['a.txt']);
});

test('unstage works before the first commit (no HEAD)', async (t) => {
  const r = makeRepo({ commits: false });
  const { post } = await serve(t, r.dir);
  r.write('x.txt', 'x');
  r.write('y.txt', 'y');
  await post('/api/stage', { all: true });
  const one = await post('/api/unstage', { paths: ['x.txt'] });
  assert.strictEqual(one.status, 200, JSON.stringify(one.body));
  const byPath = Object.fromEntries(one.body.snapshot.status.files.map((f) => [f.path, f]));
  assert.ok(byPath['x.txt'].untracked && byPath['y.txt'].staged);
  const all = await post('/api/unstage', { all: true });
  assert.ok(all.body.snapshot.status.files.every((f) => f.untracked));
});

test('commit precheck: empty message, nothing staged, missing identity', async (t) => {
  const r = makeRepo();
  const { post } = await serve(t, r.dir);
  const res = await post('/api/commit', { message: '  ' });
  assert.strictEqual(res.status, 422);
  assert.strictEqual(res.body.code, 'PRECHECK_FAILED');
  assert.deepStrictEqual(res.body.problems.map((p) => p.check).sort(), ['message', 'staged']);

  r.g('config', '--unset', 'user.name');
  r.g('config', '--unset', 'user.email');
  r.g('config', 'user.useConfigOnly', 'true'); // no hostname-derived identity (macOS would make one up)
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', EMAIL: '' };
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    r.write('a.txt', 'changed');
    await post('/api/stage', { all: true });
    const noId = await post('/api/commit', { message: 'x' });
    assert.strictEqual(noId.status, 422);
    assert.ok(noId.body.problems.some((p) => p.check === 'identity'), JSON.stringify(noId.body));
  } finally {
    for (const k of Object.keys(env)) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
  }
});

test('commit adds Co-authored-by trailers; amend rewrites HEAD', async (t) => {
  const r = makeRepo();
  const { post } = await serve(t, r.dir);
  r.write('a.txt', 'co\n');
  await post('/api/stage', { all: true });
  const c = await post('/api/commit', { message: 'pair work\n\nbody text', coAuthors: ['Ann <ann@example.com>', { name: 'Bob', email: 'bob@example.com' }] });
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  const msg = r.g('log', '-1', '--format=%B').trim();
  assert.match(msg, /^pair work\n\nbody text\n\nCo-authored-by: Ann <ann@example.com>\nCo-authored-by: Bob <bob@example.com>$/);

  const bad = await post('/api/commit', { message: 'x', allowEmpty: true, coAuthors: ['not an email'] });
  assert.strictEqual(bad.status, 400);

  const am = await post('/api/commit', { message: 'pair work (amended)', amend: true });
  assert.strictEqual(am.status, 200);
  assert.strictEqual(r.g('rev-list', '--count', 'HEAD').trim(), '2');
  assert.strictEqual(r.g('log', '-1', '--format=%s').trim(), 'pair work (amended)');
});

test('discard is two-step and restores tracked / deletes untracked files', async (t) => {
  const r = makeRepo();
  const { post, confirmed } = await serve(t, r.dir);
  r.write('a.txt', 'dirty\n');
  r.write('junk.txt', 'junk');

  const first = await post('/api/discard', { all: true });
  assert.strictEqual(first.status, 428);
  assert.match(first.body.confirmToken, /^\d+\.[\w-]+$/);
  assert.ok(first.body.confirm.details.length === 2);
  assert.strictEqual(r.read('a.txt'), 'dirty\n', 'nothing happens before confirming');

  const done = await confirmed('/api/discard', { all: true });
  assert.strictEqual(done.status, 200, JSON.stringify(done.body));
  assert.strictEqual(r.read('a.txt'), 'one\n');
  assert.ok(!fs.existsSync(path.join(r.dir, 'junk.txt')));
});

test('confirm token: wrong, stale (state changed) or for other params is rejected', async (t) => {
  const r = makeRepo();
  const { post } = await serve(t, r.dir);
  r.write('a.txt', 'dirty\n');
  r.write('b.txt', 'b');

  const bogus = await post('/api/discard', { all: true, confirmToken: '123.abc' });
  assert.strictEqual(bogus.status, 409);
  assert.ok(['CONFIRM_INVALID', 'CONFIRM_EXPIRED'].includes(bogus.body.code));

  const first = await post('/api/discard', { paths: ['a.txt'] });
  const other = await post('/api/discard', { paths: ['b.txt'], confirmToken: first.body.confirmToken });
  assert.strictEqual(other.status, 409, 'token is bound to its params');
  assert.strictEqual(other.body.code, 'CONFIRM_INVALID');

  r.write('c.txt', 'changed after the dialog opened');
  const stale = await post('/api/discard', { paths: ['a.txt'], confirmToken: first.body.confirmToken });
  assert.strictEqual(stale.status, 409, 'token is bound to repo state');
  assert.strictEqual(r.read('a.txt'), 'dirty\n');
});

test('branch create / checkout / merge (fast-forward and merge commit)', async (t) => {
  const r = makeRepo();
  const { post } = await serve(t, r.dir);

  const b = await post('/api/branch', { name: 'feature', checkout: true });
  assert.strictEqual(b.status, 200, JSON.stringify(b.body));
  assert.strictEqual(b.body.snapshot.repo.currentBranch, 'feature');
  assert.strictEqual((await post('/api/branch', { name: 'feature' })).status, 409);
  assert.strictEqual((await post('/api/branch', { name: '-bad' })).status, 400);
  assert.strictEqual((await post('/api/branch', { name: 'a..b' })).status, 400);

  r.write('f.txt', 'f');
  await post('/api/stage', { all: true });
  await post('/api/commit', { message: 'feature work' });

  assert.strictEqual((await post('/api/checkout', { ref: 'main' })).body.snapshot.repo.currentBranch, 'main');
  const ff = await post('/api/merge', { ref: 'feature' });
  assert.strictEqual(ff.status, 200, JSON.stringify(ff.body));
  assert.strictEqual(ff.body.result.fastForward, true);

  await post('/api/checkout', { ref: 'feature' });
  r.write('g.txt', 'g'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'g' });
  await post('/api/checkout', { ref: 'main' });
  r.write('h.txt', 'h'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'h' });
  const mc = await post('/api/merge', { ref: 'feature' });
  assert.strictEqual(mc.status, 200, JSON.stringify(mc.body));
  assert.strictEqual(r.g('rev-list', '--parents', '-n1', 'HEAD').trim().split(' ').length, 3);

  const det = await post('/api/checkout', { ref: r.g('rev-parse', 'HEAD~1').trim(), detach: true });
  assert.strictEqual(det.body.snapshot.repo.currentBranch, '(detached)');
});

test('checkout / merge are blocked on a dirty work tree', async (t) => {
  const r = makeRepo();
  const { post } = await serve(t, r.dir);
  await post('/api/branch', { name: 'other' });
  r.write('a.txt', 'dirty');
  for (const [ep, body] of [['/api/checkout', { ref: 'other' }], ['/api/merge', { ref: 'other' }]]) {
    const res = await post(ep, body);
    assert.strictEqual(res.status, 409, ep);
    assert.strictEqual(res.body.code, 'DIRTY_WORKTREE');
    assert.deepStrictEqual(res.body.files, ['a.txt']);
  }
  r.write('a.txt', 'one\n');
  r.write('untracked.txt', 'ok');
  assert.strictEqual((await post('/api/checkout', { ref: 'other' })).status, 200, 'untracked files do not block');
});

test('merge conflict → op state + abort; continue after resolving', async (t) => {
  const r = makeRepo();
  const { post, get } = await serve(t, r.dir);
  await post('/api/branch', { name: 'side', checkout: true });
  r.write('a.txt', 'side\n'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'side' });
  await post('/api/checkout', { ref: 'main' });
  r.write('a.txt', 'main\n'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'main' });

  const m = await post('/api/merge', { ref: 'side' });
  assert.strictEqual(m.status, 409);
  assert.strictEqual(m.body.code, 'CONFLICT');
  assert.deepStrictEqual(m.body.opState, { op: 'merge', conflicts: ['a.txt'] });
  assert.strictEqual((await post('/api/checkout', { ref: 'side' })).body.code, 'OP_IN_PROGRESS');
  assert.strictEqual((await post('/api/op/continue')).status, 422);

  const ab = await post('/api/op/abort');
  assert.strictEqual(ab.status, 200);
  assert.deepStrictEqual(ab.body.snapshot.opState, { op: null, conflicts: [] });
  assert.strictEqual(r.read('a.txt'), 'main\n');

  await post('/api/merge', { ref: 'side' });
  r.write('a.txt', 'resolved\n');
  await post('/api/stage', { paths: ['a.txt'] });
  const cont = await post('/api/op/continue');
  assert.strictEqual(cont.status, 200, JSON.stringify(cont.body));
  assert.strictEqual((await get('/api/op-state')).body.op, null);
  assert.strictEqual(r.g('rev-list', '--parents', '-n1', 'HEAD').trim().split(' ').length, 3);
});

test('merge into another branch: fast-forward without checkout, else switches', async (t) => {
  const r = makeRepo();
  const { post } = await serve(t, r.dir);
  await post('/api/branch', { name: 'feature', checkout: true });
  r.write('f.txt', 'f'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'f' });

  // On feature, merge feature into main: main is behind → ref moves, HEAD stays.
  const ff = await post('/api/merge', { ref: 'feature', into: 'main' });
  assert.strictEqual(ff.status, 200, JSON.stringify(ff.body));
  assert.deepStrictEqual([ff.body.result.fastForward, ff.body.result.switched], [true, false]);
  assert.strictEqual(r.g('rev-parse', 'main').trim(), r.g('rev-parse', 'feature').trim());
  assert.strictEqual(ff.body.snapshot.repo.currentBranch, 'feature');
  assert.strictEqual((await post('/api/merge', { ref: 'feature', into: 'main' })).body.result.upToDate, true);

  // Diverged: main gets its own commit, then merge feature into main from feature.
  await post('/api/checkout', { ref: 'main' });
  r.write('m.txt', 'm'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'm' });
  await post('/api/checkout', { ref: 'feature' });
  r.write('g.txt', 'g'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'g' });
  assert.strictEqual((await post('/api/merge', { ref: 'feature', into: 'main', ffOnly: true })).status, 409);
  const mc = await post('/api/merge', { ref: 'feature', into: 'main' });
  assert.strictEqual(mc.status, 200, JSON.stringify(mc.body));
  assert.strictEqual(mc.body.result.switched, true);
  assert.strictEqual(mc.body.snapshot.repo.currentBranch, 'main');
  assert.strictEqual(r.g('rev-list', '--parents', '-n1', 'HEAD').trim().split(' ').length, 3);

  assert.strictEqual((await post('/api/merge', { ref: 'feature', into: 'nope' })).status, 400);
});

test('rebase branch onto ref; conflict → continue; published commits need a token', async (t) => {
  const r = makeRepo();
  const { post, get, confirmed } = await serve(t, r.dir);
  await post('/api/branch', { name: 'topic', checkout: true });
  r.write('t.txt', 't'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 't' });
  await post('/api/checkout', { ref: 'main' });
  r.write('m.txt', 'm'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'm' });

  const rb = await post('/api/rebase', { branch: 'topic', onto: 'main' });
  assert.strictEqual(rb.status, 200, JSON.stringify(rb.body));
  assert.strictEqual(rb.body.snapshot.repo.currentBranch, 'topic');
  assert.strictEqual(r.g('rev-parse', 'topic~1').trim(), r.g('rev-parse', 'main').trim());
  assert.strictEqual((await post('/api/rebase', { branch: 'topic', onto: 'main' })).body.result.upToDate, true);
  assert.strictEqual((await post('/api/rebase', { branch: '-x', onto: 'main' })).status, 400);
  assert.strictEqual((await post('/api/rebase', { branch: 'topic', onto: '--exec=x' })).status, 400);

  // Conflict
  r.write('a.txt', 'topic\n'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'ta' });
  await post('/api/checkout', { ref: 'main' });
  r.write('a.txt', 'main\n'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'ma' });
  const c = await post('/api/rebase', { branch: 'topic', onto: 'main' });
  assert.strictEqual(c.status, 409, JSON.stringify(c.body));
  assert.strictEqual(c.body.code, 'CONFLICT');
  assert.strictEqual((await get('/api/op-state')).body.op, 'rebase');
  r.write('a.txt', 'both\n'); await post('/api/stage', { paths: ['a.txt'] });
  const cont = await post('/api/op/continue');
  assert.strictEqual(cont.status, 200, JSON.stringify(cont.body));
  assert.strictEqual((await get('/api/op-state')).body.op, null);
  assert.strictEqual(r.g('rev-parse', 'topic~2').trim(), r.g('rev-parse', 'main').trim());

  // Published: topic's commits are on its upstream → confirm token required.
  const bare = tmp('gd-bare-');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  r.g('remote', 'add', 'origin', bare);
  r.g('push', '-q', '-u', 'origin', 'topic');
  await post('/api/checkout', { ref: 'main' });
  r.write('n.txt', 'n'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'n' });
  const pub = await confirmed('/api/rebase', { branch: 'topic', onto: 'main' });
  assert.strictEqual(pub.status, 200, JSON.stringify(pub.body));
  assert.strictEqual(r.g('rev-parse', 'topic~2').trim(), r.g('rev-parse', 'main').trim());
});

test('reset: soft/mixed run directly, hard needs token + CONFIRM', async (t) => {
  const r = makeRepo();
  const { post } = await serve(t, r.dir);
  r.write('a.txt', 'two\n'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'second' });
  const first = r.g('rev-parse', 'HEAD~1').trim();

  const soft = await post('/api/reset', { target: first, mode: 'soft' });
  assert.strictEqual(soft.status, 200);
  assert.ok(soft.body.snapshot.status.files.find((f) => f.path === 'a.txt').staged);
  await post('/api/commit', { message: 'second again' });

  const req = await post('/api/reset', { target: first, mode: 'hard' });
  assert.strictEqual(req.status, 428);
  assert.strictEqual(req.body.confirm.risk, 'high');
  assert.strictEqual(req.body.confirm.typed, true);
  const noText = await post('/api/reset', { target: first, mode: 'hard', confirmToken: req.body.confirmToken });
  assert.strictEqual(noText.status, 400);
  assert.strictEqual(noText.body.code, 'CONFIRM_TEXT_REQUIRED');
  const ok = await post('/api/reset', { target: first, mode: 'hard', confirmToken: req.body.confirmToken, confirmText: 'CONFIRM' });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.strictEqual(r.g('rev-parse', 'HEAD').trim(), first);
  assert.strictEqual(r.read('a.txt'), 'one\n');
});

test('revert and cherry-pick', async (t) => {
  const r = makeRepo();
  const { post } = await serve(t, r.dir);
  await post('/api/branch', { name: 'pick' });
  r.write('n.txt', 'n'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'add n' });
  const added = r.g('rev-parse', 'HEAD').trim();

  const rv = await post('/api/revert', { hash: added });
  assert.strictEqual(rv.status, 200, JSON.stringify(rv.body));
  assert.ok(!fs.existsSync(path.join(r.dir, 'n.txt')));

  await post('/api/checkout', { ref: 'pick' });
  const cp = await post('/api/cherry-pick', { hash: added });
  assert.strictEqual(cp.status, 200, JSON.stringify(cp.body));
  assert.strictEqual(r.read('n.txt'), 'n');
  assert.strictEqual((await post('/api/revert', { hash: '--help' })).status, 400);
});

test('branch delete: merged = token, unmerged = token + CONFIRM; current branch refused', async (t) => {
  const r = makeRepo();
  const { post, confirmed } = await serve(t, r.dir);
  await post('/api/branch', { name: 'merged' });
  await post('/api/branch', { name: 'wip', checkout: true });
  r.write('w.txt', 'w'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'wip' });
  assert.strictEqual((await post('/api/branch/delete', { name: 'wip' })).status, 409, 'current branch');
  await post('/api/checkout', { ref: 'main' });

  const m = await post('/api/branch/delete', { name: 'merged' });
  assert.strictEqual(m.status, 428);
  assert.notStrictEqual(m.body.confirm.typed, true);
  assert.strictEqual((await confirmed('/api/branch/delete', { name: 'merged' })).status, 200);

  const u = await post('/api/branch/delete', { name: 'wip' });
  assert.strictEqual(u.body.confirm.risk, 'high');
  const done = await confirmed('/api/branch/delete', { name: 'wip' }, { confirmText: 'CONFIRM' });
  assert.strictEqual(done.status, 200, JSON.stringify(done.body));
  assert.strictEqual(done.body.result.merged, false);
  assert.strictEqual(r.g('branch', '--list', 'wip').trim(), '');
});

test('tags: lightweight, annotated, two-step delete', async (t) => {
  const r = makeRepo();
  const { post, confirmed, get } = await serve(t, r.dir);
  assert.strictEqual((await post('/api/tag', { name: 'v1' })).status, 200);
  const an = await post('/api/tag', { name: 'v2', message: 'release 2' });
  assert.strictEqual(an.body.result.annotated, true);
  assert.strictEqual(r.g('cat-file', '-t', 'v2').trim(), 'tag');
  const refs = (await get('/api/refs')).body;
  const v2 = refs.find((x) => x.short === 'v2');
  assert.strictEqual(v2.target, r.g('rev-parse', 'HEAD').trim(), 'annotated tag is peeled to its commit');
  assert.strictEqual((await post('/api/tag', { name: 'v1' })).status, 409);
  assert.strictEqual((await confirmed('/api/tag/delete', { name: 'v1' })).status, 200);
  assert.strictEqual(r.g('tag', '--list', 'v1').trim(), '');
});

test('stash: push, list, apply, pop, two-step drop', async (t) => {
  const r = makeRepo();
  const { post, get, confirmed } = await serve(t, r.dir);
  assert.strictEqual((await post('/api/stash', {})).status, 422, 'nothing to stash');
  r.write('a.txt', 's1\n');
  const p1 = await post('/api/stash', { message: 'first stash' });
  assert.strictEqual(p1.status, 200, JSON.stringify(p1.body));
  assert.strictEqual(r.read('a.txt'), 'one\n');
  r.write('u.txt', 'untracked');
  await post('/api/stash', { message: 'second', includeUntracked: true });
  assert.ok(!fs.existsSync(path.join(r.dir, 'u.txt')));

  const list = (await get('/api/stashes')).body;
  assert.deepStrictEqual(list.map((s) => s.ref), ['stash@{0}', 'stash@{1}']);
  assert.match(list[1].message, /first stash/);

  assert.strictEqual((await post('/api/stash/pop', { index: 0 })).status, 200);
  assert.ok(fs.existsSync(path.join(r.dir, 'u.txt')));
  fs.unlinkSync(path.join(r.dir, 'u.txt'));
  assert.strictEqual((await post('/api/stash/apply', { index: 0 })).status, 200);
  assert.strictEqual(r.read('a.txt'), 's1\n');
  const drop = await confirmed('/api/stash/drop', { index: 0 });
  assert.strictEqual(drop.status, 200);
  assert.strictEqual(drop.body.snapshot.stashes.length, 0);
});

test('push / fetch / pull against a local bare remote; ahead-behind; force push', async (t) => {
  const bare = tmp('gd-bare-');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const r = makeRepo();
  r.g('remote', 'add', 'origin', bare);
  const { post, get, confirmed } = await serve(t, r.dir);

  assert.deepStrictEqual((await get('/api/ahead-behind')).body, { ahead: 0, behind: 0, noUpstream: true });
  assert.strictEqual((await post('/api/pull')).body.code, 'NO_UPSTREAM');
  const p = await post('/api/push');
  assert.strictEqual(p.status, 200, JSON.stringify(p.body));
  assert.strictEqual(p.body.result.setUpstream, true);
  assert.deepStrictEqual(p.body.snapshot.aheadBehind, { ahead: 0, behind: 0, upstream: 'origin/main' });

  r.write('a.txt', 'local\n'); await post('/api/stage', { all: true }); await post('/api/commit', { message: 'local' });
  assert.strictEqual((await get('/api/ahead-behind')).body.ahead, 1);
  assert.strictEqual((await post('/api/push')).status, 200);

  // Someone else pushes.
  const other = tmp('gd-other-');
  execFileSync('git', ['clone', '-q', bare, other]);
  const og = (...a) => execFileSync('git', ['-C', other, '-c', 'user.name=O', '-c', 'user.email=o@example.com', ...a]);
  fs.writeFileSync(path.join(other, 'o.txt'), 'o');
  og('add', '.'); og('commit', '-q', '-m', 'other'); og('push', '-q');

  const f = await post('/api/fetch');
  assert.strictEqual(f.status, 200, JSON.stringify(f.body));
  assert.strictEqual(f.body.snapshot.aheadBehind.behind, 1);
  const pull = await post('/api/pull');
  assert.strictEqual(pull.status, 200, JSON.stringify(pull.body));
  assert.ok(fs.existsSync(path.join(r.dir, 'o.txt')));

  // Diverge: rewrite local history, then a normal push is rejected.
  r.g('reset', '-q', '--hard', 'HEAD~1');
  r.write('a.txt', 'rewritten\n'); r.g('commit', '-qam', 'rewritten');
  const rej = await post('/api/push');
  assert.strictEqual(rej.status, 409);
  assert.strictEqual(rej.body.code, 'PUSH_REJECTED');

  const lease = await post('/api/push', { force: 'lease' });
  assert.strictEqual(lease.status, 428);
  assert.strictEqual(lease.body.confirm.typed, true);
  assert.strictEqual(lease.body.confirm.checkbox, undefined);
  const forced = await confirmed('/api/push', { force: 'lease' }, { confirmText: 'CONFIRM' });
  assert.strictEqual(forced.status, 200, JSON.stringify(forced.body));
  assert.strictEqual(execFileSync('git', ['-C', bare, 'log', '-1', '--format=%s', 'main']).toString().trim(), 'rewritten');

  const pure = await post('/api/push', { force: 'force' });
  assert.ok(pure.body.confirm.checkbox, 'pure --force asks for a second acknowledgement');
  const noAck = await post('/api/push', { force: 'force', confirmToken: pure.body.confirmToken, confirmText: 'CONFIRM' });
  assert.strictEqual(noAck.body.code, 'FORCE_NOT_ACKNOWLEDGED');
});

test('remote errors are mapped and do not leak credentials', async (t) => {
  const r = makeRepo();
  r.g('remote', 'add', 'origin', 'https://user:s3cret@127.0.0.1:1/repo.git');
  const { post } = await serve(t, r.dir);
  const f = await post('/api/fetch');
  assert.ok(f.status >= 400);
  assert.doesNotMatch(JSON.stringify(f.body), /s3cret/);
});

test('maskSecrets hides URL credentials and tokens', () => {
  const s = maskSecrets('fatal: https://bob:hunter2@github.com/x.git https://x-access-token:ghs_abc@github.com ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.doesNotMatch(s, /hunter2|ghs_abc|ghp_a/);
});

test('per-repo lock serializes concurrent writes', async (t) => {
  const order = [];
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  await Promise.all([
    withLock('k', async () => { order.push('a1'); await sleep(30); order.push('a2'); }),
    withLock('k', async () => { order.push('b1'); await sleep(5); order.push('b2'); }),
    withLock('k', async () => { throw new Error('x'); }).catch(() => order.push('c')),
    withLock('k', async () => { order.push('d'); }),
  ]);
  assert.deepStrictEqual(order, ['a1', 'a2', 'b1', 'b2', 'c', 'd']);

  // Without the lock, parallel `git add` would race on index.lock.
  const r = makeRepo();
  const { post } = await serve(t, r.dir);
  for (let i = 0; i < 8; i++) r.write(`f${i}.txt`, String(i));
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => post('/api/stage', { paths: [`f${i}.txt`] })));
  assert.ok(results.every((x) => x.status === 200), JSON.stringify(results.map((x) => x.body.error)));
  assert.strictEqual(r.g('diff', '--cached', '--name-only').trim().split('\n').length, 8);
});

test('writes require POST + application/json (CSRF guard)', async (t) => {
  const r = makeRepo();
  const { app } = await serve(t, r.dir);
  assert.strictEqual((await fetch(`${app.url}/api/stage`)).status, 405);
  const form = await fetch(`${app.url}/api/stage`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"all":true}' });
  assert.strictEqual(form.status, 415);
  const badJson = await fetch(`${app.url}/api/stage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[1]' });
  assert.strictEqual(badJson.status, 400);
});

test('status parsing (-z): renames, conflicts, special characters', () => {
  const st = parseStatusZ('## main\0R  new name.txt\0old name.txt\0UU c.txt\0?? "q".txt\0MM m.txt\0');
  assert.strictEqual(st.branchLine, 'main');
  assert.deepStrictEqual(st.files.map((f) => [f.path, f.staged, f.unstaged, f.conflicted]), [
    ['new name.txt', true, false, false],
    ['c.txt', false, true, true],
    ['"q".txt', false, true, false],
    ['m.txt', true, true, false],
  ]);
  assert.strictEqual(st.files[0].origPath, 'old name.txt');
});

test('/api/commit: GET reads commit detail, POST creates a commit', async (t) => {
  const r = makeRepo();
  const { get, post } = await serve(t, r.dir);
  const head = r.g('rev-parse', 'HEAD').trim();
  const d = await get(`/api/commit?hash=${head}`);
  assert.strictEqual(d.status, 200);
  assert.strictEqual(d.body.subject, 'first');
  assert.strictEqual((await get('/api/commit?hash=zz')).status, 400, 'bad hash is a 400 now');
  assert.strictEqual((await post('/api/commit', { message: 'x', allowEmpty: true })).status, 200);
});
