'use strict';

const LANE_W = 18, ROW_H = 28, PAD = 14, NODE_R = 5;
const LANE_COLORS = [
  '#46a6ff', '#6ee7b7', '#f0b457', '#f0768b', '#b98cf0',
  '#4fd1c5', '#f6ad55', '#a0aec0', '#63b3ed', '#9ae6b4',
];
const laneColor = (i) => LANE_COLORS[((i % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length];

const $ = (id) => document.getElementById(id);
const state = { repo: null, commits: [], refs: [], selected: null, repoPath: undefined };

function qsRepo() {
  return new URL(location.href).searchParams.get('repo') || undefined;
}
function api(ep, params = {}) {
  const u = new URL(ep, location.origin);
  const repo = state.repoPath || qsRepo();
  if (repo) u.searchParams.set('repo', repo);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return fetch(u).then((r) => r.json());
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('ko-KR', sameYear
    ? { month: '2-digit', day: '2-digit' }
    : { year: '2-digit', month: '2-digit', day: '2-digit' })
    + ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function layout(commits) {
  const index = new Map(commits.map((c, i) => [c.hash, i]));
  const lanes = [];
  const rows = [];
  let maxLane = 0;

  const firstFree = () => {
    for (let k = 0; k < lanes.length; k++) if (lanes[k] == null) return k;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    let myLane = lanes.indexOf(c.hash);
    if (myLane === -1) myLane = firstFree();
    lanes[myLane] = null;

    const parents = c.parents.filter((p) => index.has(p));
    if (parents.length > 0) {
      const p0 = parents[0];
      let p0lane = lanes.indexOf(p0);
      if (p0lane === -1) { lanes[myLane] = p0; p0lane = myLane; }
      for (let j = 1; j < parents.length; j++) {
        const pj = parents[j];
        let pl = lanes.indexOf(pj);
        if (pl === -1) { pl = firstFree(); lanes[pl] = pj; }
      }
    }

    maxLane = Math.max(maxLane, lanes.length, myLane + 1);
    rows.push({ commit: c, lane: myLane });
  }
  return { rows, laneCount: Math.max(1, maxLane) };
}

const laneX = (k) => PAD + k * LANE_W;

function drawGraph(rows, laneCount) {
  const svg = $('graph');
  const width = PAD * 2 + laneCount * LANE_W;
  const height = rows.length * ROW_H + ROW_H;
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.style.width = width + 'px';

  const yOf = (i) => i * ROW_H + ROW_H / 2;
  const posByHash = new Map(rows.map((r, i) => [r.commit.hash, { i, lane: r.lane }]));
  let out = '';

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const x1 = laneX(r.lane), y1 = yOf(i);
    for (const ph of r.commit.parents) {
      const pp = posByHash.get(ph);
      if (!pp) continue;
      const x2 = laneX(pp.lane), y2 = yOf(pp.i);
      const color = laneColor(Math.max(r.lane, pp.lane));
      if (x1 === x2) {
        out += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2"/>`;
      } else {
        const my = y1 + ROW_H * 0.5;
        out += `<path d="M${x1},${y1} C${x1},${my} ${x2},${y2 - ROW_H * 0.5} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="2"/>`;
      }
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    out += `<circle cx="${laneX(r.lane)}" cy="${yOf(i)}" r="${NODE_R}" fill="${laneColor(r.lane)}" stroke="#15171c" stroke-width="2"/>`;
  }
  svg.innerHTML = out;
  return width;
}

function refsByCommit(refs) {
  const m = new Map();
  for (const ref of refs) {
    if (!m.has(ref.oid)) m.set(ref.oid, []);
    m.get(ref.oid).push(ref);
  }
  return m;
}

function renderList(rows, graphWidth, refs) {
  const ul = $('commitList');
  const rmap = refsByCommit(refs);
  ul.innerHTML = '';
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i].commit;
    const li = document.createElement('li');
    li.dataset.hash = c.hash;
    li.style.height = ROW_H + 'px';

    const spacer = document.createElement('span');
    spacer.className = 'c-spacer';
    spacer.style.width = graphWidth + 'px';
    li.appendChild(spacer);

    const chips = document.createElement('span');
    chips.className = 'c-refs';
    for (const ref of (rmap.get(c.hash) || [])) {
      const chip = document.createElement('span');
      chip.className = 'c-chip ' + (ref.isHead ? 'head' : ref.type);
      chip.textContent = ref.type === 'tag' ? '🏷 ' + ref.short : ref.short;
      chips.appendChild(chip);
    }
    li.appendChild(chips);

    const subj = document.createElement('span');
    subj.className = 'c-subject';
    subj.textContent = c.subject;
    li.appendChild(subj);

    const author = document.createElement('span');
    author.className = 'c-author';
    author.textContent = c.author;
    li.appendChild(author);

    const date = document.createElement('span');
    date.className = 'c-date';
    date.textContent = shortDate(c.date);
    li.appendChild(date);

    const hash = document.createElement('span');
    hash.className = 'c-hash';
    hash.textContent = c.hash.slice(0, 7);
    li.appendChild(hash);

    li.addEventListener('click', () => selectCommit(c.hash, li));
    ul.appendChild(li);
  }
}

async function selectCommit(hash, li) {
  document.querySelectorAll('#commitList li.selected').forEach((e) => e.classList.remove('selected'));
  if (li) li.classList.add('selected');
  state.selected = hash;
  const d = await api('/api/commit', { hash });
  $('detailEmpty').hidden = true;
  const body = $('detailBody');
  body.hidden = false;
  body.innerHTML = `
    <h2>${escapeHtml(d.subject)}</h2>
    <div class="kv">
      <span class="k">commit</span><span class="v mono">${d.hash}</span>
      <span class="k">parents</span><span class="v mono">${d.parents.map((p) => p.slice(0, 7)).join(', ') || '(root)'}</span>
      <span class="k">author</span><span class="v">${escapeHtml(d.author)} &lt;${escapeHtml(d.email)}&gt;</span>
      <span class="k">date</span><span class="v">${new Date(d.authorDate).toLocaleString('ko-KR')}</span>
    </div>
    ${d.body ? `<div class="body-text">${escapeHtml(d.body)}</div>` : ''}
    <div class="stat">${escapeHtml(d.stat || '(no file stats)')}</div>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderRefs(refs) {
  const groups = { local: [], remote: [], tag: [] };
  for (const r of refs) groups[r.type]?.push(r);
  const fill = (ulId, countId, arr, cls) => {
    const ul = $(ulId); ul.innerHTML = '';
    $(countId).textContent = arr.length;
    for (const r of arr) {
      const li = document.createElement('li');
      if (r.isHead) li.classList.add('head');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = cls === 'tag' ? '#f0b457' : (r.isHead ? '#6ee7b7' : '#46a6ff');
      li.appendChild(dot);
      const label = document.createElement('span');
      label.textContent = r.short;
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      li.appendChild(label);
      const mini = document.createElement('span');
      mini.className = 'mini';
      mini.textContent = r.oid.slice(0, 7);
      li.appendChild(mini);
      li.title = r.refname;
      li.addEventListener('click', () => {
        const el = document.querySelector(`#commitList li[data-hash="${r.oid}"]`);
        if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.click(); }
      });
      ul.appendChild(li);
    }
  };
  fill('localRefs', 'localCount', groups.local, 'local');
  fill('remoteRefs', 'remoteCount', groups.remote, 'remote');
  fill('tagRefs', 'tagCount', groups.tag, 'tag');
}

async function load() {
  try {
    const [repo, refs, commits, status] = await Promise.all([
      api('/api/repo'), api('/api/refs'), api('/api/commits', { limit: 400 }), api('/api/status'),
    ]);
    if (repo.error) throw new Error(repo.error);
    state.repo = repo; state.refs = refs; state.commits = commits;

    $('repoinfo').innerHTML = `<b>${escapeHtml(repo.name)}</b> · on <b>${escapeHtml(repo.currentBranch)}</b> · ${commits.length} commits loaded`;
    $('repoInput').value = repo.path;

    const dirty = status.count > 0;
    $('status').innerHTML = dirty
      ? `<span class="dirty">● ${status.count} change${status.count > 1 ? 's' : ''}</span>`
      : `<span class="clean">✓ clean</span>`;

    const { rows, laneCount } = layout(commits);
    const gw = drawGraph(rows, laneCount);
    renderList(rows, gw, refs);
    renderRefs(refs);
    $('sbLeft').textContent = repo.path;
  } catch (e) {
    $('repoinfo').innerHTML = `<span style="color:#f0768b">${escapeHtml(e.message)}</span>`;
    $('commitList').innerHTML = '';
    $('graph').innerHTML = '';
  }
}

$('refreshBtn').addEventListener('click', load);
$('repoInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { state.repoPath = e.target.value.trim(); load(); }
});
load();
