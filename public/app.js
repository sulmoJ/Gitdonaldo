'use strict';

const LANE_W = 18, ROW_H = 28, PAD = 14, NODE_R = 5;
const LANE_COLORS = [
  '#46a6ff', '#6ee7b7', '#f0b457', '#f0768b', '#b98cf0',
  '#4fd1c5', '#f6ad55', '#a0aec0', '#63b3ed', '#9ae6b4',
];
const laneColor = (i) => LANE_COLORS[((i % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length];

const $ = (id) => document.getElementById(id);
const state = {
  repo: null, commits: [], refs: [], selected: null, repoPath: undefined,
  status: null, aheadBehind: null, opState: null, stashes: [], workOpen: true, busy: false,
};

// Desktop bridge exposed by electron/preload.js; undefined in browser mode.
const desktop = window.gitdonaldo;
// Per-launch API token (desktop mode passes it in the page URL).
const API_TOKEN = new URL(location.href).searchParams.get('token');

function qsRepo() {
  return new URL(location.href).searchParams.get('repo') || undefined;
}
function authHeaders(extra = {}) {
  return API_TOKEN ? { ...extra, 'x-gitdonaldo-token': API_TOKEN } : extra;
}
function apiUrl(ep, params = {}) {
  const u = new URL(ep, location.origin);
  const repo = state.repoPath || qsRepo();
  if (repo) u.searchParams.set('repo', repo);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
}
function api(ep, params = {}) {
  return fetch(apiUrl(ep, params), { headers: authHeaders() }).then((r) => r.json());
}
/** POST a write. Resolves { status, body } and never throws on HTTP errors. */
async function post(ep, body = {}) {
  try {
    const r = await fetch(apiUrl(ep), {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  } catch (e) {
    return { status: 0, body: { error: `서버에 연결하지 못했습니다: ${e.message}`, code: 'NETWORK' } };
  }
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

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- toasts ------------------------------------------------------------------------------

function toast(message, kind = 'ok', details) {
  const t = el('div', `toast ${kind}`);
  t.appendChild(el('div', 'toast-msg', message));
  if (details) t.appendChild(el('pre', 'toast-details', details));
  t.title = '클릭하면 닫힙니다';
  t.addEventListener('click', () => t.remove());
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? 10000 : 3500);
}

// ---- modal: confirm & prompt -------------------------------------------------------------

let closeModal = null;

/**
 * Generic dialog. fields: [{ name, label, type: 'text'|'textarea'|'checkbox', value, placeholder }].
 * Resolves the field values (plus `confirmText`) or null when cancelled.
 */
function openDialog({ title, message, details, fields = [], okLabel = '확인', danger = false, typed = false, checkbox = null }) {
  if (closeModal) closeModal(null);
  const modal = $('modal');
  modal.innerHTML = '';
  modal.classList.toggle('danger', danger);
  modal.appendChild(el('h3', null, title));
  if (message) modal.appendChild(el('p', 'modal-msg', message));
  if (details && details.length) modal.appendChild(el('pre', 'modal-details', details.join('\n')));

  const inputs = {};
  for (const f of fields) {
    const wrap = el('label', f.type === 'checkbox' ? 'chk' : 'field');
    let input;
    if (f.type === 'checkbox') {
      input = el('input'); input.type = 'checkbox'; input.checked = Boolean(f.value);
      wrap.appendChild(input); wrap.appendChild(document.createTextNode(' ' + f.label));
    } else {
      wrap.appendChild(el('span', 'field-label', f.label));
      input = el(f.type === 'textarea' ? 'textarea' : 'input');
      if (f.type !== 'textarea') input.type = 'text';
      input.value = f.value || '';
      input.placeholder = f.placeholder || '';
      input.spellcheck = false;
      wrap.appendChild(input);
    }
    inputs[f.name] = input;
    modal.appendChild(wrap);
  }

  let typedInput = null, ackInput = null;
  if (checkbox) {
    const wrap = el('label', 'chk warn');
    ackInput = el('input'); ackInput.type = 'checkbox';
    wrap.appendChild(ackInput); wrap.appendChild(document.createTextNode(' ' + checkbox));
    modal.appendChild(wrap);
  }
  if (typed) {
    const wrap = el('label', 'field');
    wrap.appendChild(el('span', 'field-label', '계속하려면 CONFIRM 을 입력하세요'));
    typedInput = el('input'); typedInput.type = 'text'; typedInput.placeholder = 'CONFIRM'; typedInput.spellcheck = false;
    typedInput.id = 'confirmTextInput';
    wrap.appendChild(typedInput);
    modal.appendChild(wrap);
  }

  const actions = el('div', 'modal-actions');
  const cancel = el('button', 'btn', '취소');
  const ok = el('button', `btn ${danger ? 'danger' : 'primary'}`, okLabel);
  ok.id = 'modalOkBtn';
  actions.appendChild(cancel); actions.appendChild(ok);
  modal.appendChild(actions);

  const refresh = () => {
    ok.disabled = Boolean((typedInput && typedInput.value !== 'CONFIRM') || (ackInput && !ackInput.checked));
  };
  if (typedInput) typedInput.addEventListener('input', refresh);
  if (ackInput) ackInput.addEventListener('change', refresh);
  refresh();

  $('modalRoot').hidden = false;
  (typedInput || Object.values(inputs).find((i) => i.type !== 'checkbox') || ok).focus();

  return new Promise((resolve) => {
    const onKey = (e) => {
      if (e.key === 'Escape') finish(null);
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !ok.disabled) { e.preventDefault(); submit(); }
    };
    function finish(v) {
      $('modalRoot').hidden = true;
      modal.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      closeModal = null;
      resolve(v);
    }
    function submit() {
      const values = {};
      for (const [k, i] of Object.entries(inputs)) values[k] = i.type === 'checkbox' ? i.checked : i.value;
      if (typedInput) values.confirmText = typedInput.value;
      if (ackInput) values.acknowledged = ackInput.checked;
      finish(values);
    }
    closeModal = finish;
    cancel.addEventListener('click', () => finish(null));
    ok.addEventListener('click', submit);
    document.addEventListener('keydown', onKey, true);
  });
}

/** Dialog for a server-issued 428 CONFIRM_REQUIRED. */
function confirmDialog(c) {
  return openDialog({
    title: c.title,
    message: c.message,
    details: c.details,
    okLabel: c.action || '확인',
    danger: true,
    typed: Boolean(c.typed),
    checkbox: c.checkbox || null,
  });
}

// ---- write runner ------------------------------------------------------------------------

function setBusy(on, label) {
  state.busy = on;
  document.body.classList.toggle('busy', on);
  $('sbRight').textContent = on ? `⏳ ${label}…` : 'Gitdonaldo';
}

/**
 * Run a write endpoint: handles the two-step confirmation, shows a toast, then reloads
 * everything (sync B1: full re-query instead of applying the snapshot incrementally).
 */
async function runWrite(ep, body, { label, success, button } = {}) {
  if (state.busy) { toast('다른 작업이 진행 중입니다.', 'warn'); return null; }
  setBusy(true, label || ep.replace('/api/', ''));
  if (button) button.classList.add('spinning');
  try {
    let res = await post(ep, body);
    if (res.status === 428 && res.body.code === 'CONFIRM_REQUIRED') {
      setBusy(false);
      if (button) button.classList.remove('spinning');
      const ans = await confirmDialog(res.body.confirm);
      if (!ans) return null;
      setBusy(true, label || ep);
      if (button) button.classList.add('spinning');
      const second = { ...body, confirmToken: res.body.confirmToken };
      if (ans.confirmText != null) second.confirmText = ans.confirmText;
      if (ans.acknowledged) second.acknowledgeForce = true;
      res = await post(ep, second);
    }
    const b = res.body || {};
    if (b.ok) {
      if (success) toast(typeof success === 'function' ? success(b.result) : success, 'ok');
      await load();
      return b;
    }
    const detail = b.problems ? null : (b.stderr || (b.files ? b.files.join('\n') : null));
    toast(b.error || `실패 (${res.status})`, b.code === 'CONFLICT' ? 'warn' : 'error', detail);
    if (['CONFLICT', 'OP_IN_PROGRESS', 'CONFIRM_INVALID', 'PUSH_REJECTED'].includes(b.code)) await load();
    return null;
  } finally {
    if (button) button.classList.remove('spinning');
    setBusy(false);
  }
}

// ---- context menu ------------------------------------------------------------------------

/** items: [{ label, action, danger, disabled } | '-'] */
function openMenu(x, y, items) {
  const menu = $('ctxMenu');
  menu.innerHTML = '';
  for (const it of items) {
    if (it === '-') { menu.appendChild(el('div', 'ctx-sep')); continue; }
    if (it.header) { menu.appendChild(el('div', 'ctx-head', it.header)); continue; }
    const b = el('button', `ctx-item${it.danger ? ' danger' : ''}`, it.label);
    b.disabled = Boolean(it.disabled);
    b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => { hideMenu(); it.action(); });
    menu.appendChild(b);
  }
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
}
function hideMenu() { $('ctxMenu').hidden = true; }
document.addEventListener('click', (e) => { if (!$('ctxMenu').contains(e.target)) hideMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });
window.addEventListener('blur', hideMenu);

const currentBranch = () => (state.repo && state.repo.currentBranch !== '(detached)' ? state.repo.currentBranch : null);

async function promptBranch(start, startLabel) {
  const v = await openDialog({
    title: `새 브랜치 (${startLabel})`,
    fields: [
      { name: 'name', label: '브랜치 이름', placeholder: 'feature/…' },
      { name: 'checkout', label: '만든 뒤 체크아웃', type: 'checkbox', value: true },
    ],
    okLabel: '만들기',
  });
  if (!v || !v.name.trim()) return;
  runWrite('/api/branch', { name: v.name.trim(), start, checkout: v.checkout }, { label: 'branch', success: `브랜치 ${v.name.trim()} 생성` });
}

async function promptTag(target, targetLabel) {
  const v = await openDialog({
    title: `새 태그 (${targetLabel})`,
    fields: [
      { name: 'name', label: '태그 이름', placeholder: 'v1.0.0' },
      { name: 'message', label: '메시지 (입력하면 주석 태그)', type: 'textarea' },
    ],
    okLabel: '만들기',
  });
  if (!v || !v.name.trim()) return;
  runWrite('/api/tag', { name: v.name.trim(), target, message: v.message }, { label: 'tag', success: `태그 ${v.name.trim()} 생성` });
}

function mergeInto(ref) {
  const cur = currentBranch() || 'HEAD';
  runWrite('/api/merge', { ref }, {
    label: 'merge',
    success: (r) => (r.upToDate ? '이미 최신입니다' : `${ref} → ${cur} 머지 완료${r.fastForward ? ' (fast-forward)' : ''}`),
  });
}

function checkout(ref, opts = {}) {
  runWrite('/api/checkout', { ref, ...opts }, {
    label: 'checkout',
    success: (r) => (r.detached ? `${r.detached.slice(0, 7)} 체크아웃 (detached HEAD)` : `${r.branch} 체크아웃`),
  });
}

function refMenu(e, r) {
  e.preventDefault();
  const cur = currentBranch();
  if (r.type === 'local') {
    openMenu(e.clientX, e.clientY, [
      { header: r.short },
      { label: '체크아웃', disabled: r.isHead, action: () => checkout(r.short) },
      { label: `${cur || 'HEAD'}에 머지`, disabled: r.isHead, action: () => mergeInto(r.short) },
      '-',
      { label: '여기서 새 브랜치…', action: () => promptBranch(r.short, r.short) },
      { label: '여기에 태그…', action: () => promptTag(r.short, r.short) },
      '-',
      { label: '브랜치 삭제…', danger: true, disabled: r.isHead, action: () => runWrite('/api/branch/delete', { name: r.short }, { label: 'branch delete', success: `브랜치 ${r.short} 삭제` }) },
    ]);
  } else if (r.type === 'remote') {
    openMenu(e.clientX, e.clientY, [
      { header: r.short },
      { label: '체크아웃 (로컬 추적 브랜치)', action: () => checkout(r.short) },
      { label: `${cur || 'HEAD'}에 머지`, action: () => mergeInto(r.short) },
      '-',
      { label: '여기서 새 브랜치…', action: () => promptBranch(r.short, r.short) },
    ]);
  } else {
    openMenu(e.clientX, e.clientY, [
      { header: `🏷 ${r.short}` },
      { label: '체크아웃 (detached)', action: () => checkout(r.short, { detach: true }) },
      { label: '여기서 새 브랜치…', action: () => promptBranch(r.short, r.short) },
      '-',
      { label: '태그 삭제…', danger: true, action: () => runWrite('/api/tag/delete', { name: r.short }, { label: 'tag delete', success: `태그 ${r.short} 삭제` }) },
    ]);
  }
}

function commitMenu(e, c) {
  e.preventDefault();
  const short = c.hash.slice(0, 7);
  const cur = currentBranch() || 'HEAD';
  const reset = (mode) => runWrite('/api/reset', { target: c.hash, mode }, { label: `reset --${mode}`, success: `${cur}을(를) ${short}(으)로 reset --${mode}` });
  openMenu(e.clientX, e.clientY, [
    { header: `${short} ${c.subject.slice(0, 40)}` },
    { label: '여기서 새 브랜치…', action: () => promptBranch(c.hash, short) },
    { label: '체크아웃 (detached)', action: () => checkout(c.hash, { detach: true }) },
    { label: '여기에 태그…', action: () => promptTag(c.hash, short) },
    '-',
    { label: `${cur}에 cherry-pick`, action: () => runWrite('/api/cherry-pick', { hash: c.hash }, { label: 'cherry-pick', success: `${short} cherry-pick 완료` }) },
    { label: '커밋 되돌리기 (revert)', action: () => runWrite('/api/revert', { hash: c.hash }, { label: 'revert', success: `${short} revert 커밋 생성` }) },
    '-',
    { label: `${cur}을(를) 여기로 reset — soft`, action: () => reset('soft') },
    { label: `${cur}을(를) 여기로 reset — mixed`, action: () => reset('mixed') },
    { label: `${cur}을(를) 여기로 reset — hard…`, danger: true, action: () => reset('hard') },
  ]);
}

function stashMenu(e, s) {
  e.preventDefault();
  openMenu(e.clientX, e.clientY, [
    { header: s.ref },
    { label: '적용 (apply)', action: () => runWrite('/api/stash/apply', { index: s.index }, { label: 'stash apply', success: `${s.ref} 적용` }) },
    { label: '꺼내기 (pop)', action: () => runWrite('/api/stash/pop', { index: s.index }, { label: 'stash pop', success: `${s.ref} pop` }) },
    '-',
    { label: '삭제 (drop)…', danger: true, action: () => runWrite('/api/stash/drop', { index: s.index }, { label: 'stash drop', success: `${s.ref} 삭제` }) },
  ]);
}

// ---- commit list & detail ----------------------------------------------------------------

function refsByCommit(refs) {
  const m = new Map();
  for (const ref of refs) {
    const oid = ref.target || ref.oid;
    if (!m.has(oid)) m.set(oid, []);
    m.get(oid).push(ref);
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
    if (state.repo && c.hash === state.repo.head) li.classList.add('is-head');

    const spacer = el('span', 'c-spacer');
    spacer.style.width = graphWidth + 'px';
    li.appendChild(spacer);

    const chips = el('span', 'c-refs');
    for (const ref of (rmap.get(c.hash) || [])) {
      const chip = el('span', 'c-chip ' + (ref.isHead ? 'head' : ref.type), ref.type === 'tag' ? '🏷 ' + ref.short : ref.short);
      chip.addEventListener('contextmenu', (e) => { e.stopPropagation(); refMenu(e, ref); });
      chip.addEventListener('dblclick', (e) => { e.stopPropagation(); if (ref.type !== 'tag' && !ref.isHead) checkout(ref.short); });
      chips.appendChild(chip);
    }
    li.appendChild(chips);

    li.appendChild(el('span', 'c-subject', c.subject));
    li.appendChild(el('span', 'c-author', c.author));
    li.appendChild(el('span', 'c-date', shortDate(c.date)));
    li.appendChild(el('span', 'c-hash', c.hash.slice(0, 7)));

    li.addEventListener('click', () => selectCommit(c.hash, li));
    li.addEventListener('contextmenu', (e) => commitMenu(e, c));
    ul.appendChild(li);
  }
}

let detailSeq = 0;
async function selectCommit(hash, li) {
  document.querySelectorAll('#commitList li.selected').forEach((e) => e.classList.remove('selected'));
  if (li) li.classList.add('selected');
  state.selected = hash;
  const seq = ++detailSeq;
  const d = await api('/api/commit', { hash });
  if (seq !== detailSeq) return; // a later click won
  $('detailEmpty').hidden = true;
  const body = $('detailBody');
  body.hidden = false;
  if (d.error) { body.innerHTML = `<div class="error">${escapeHtml(d.error)}</div>`; return; }
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

function clearDetail() {
  state.selected = null;
  $('detailBody').hidden = true;
  $('detailBody').innerHTML = '';
  $('detailEmpty').hidden = false;
}

// ---- sidebar -----------------------------------------------------------------------------

function renderRefs(refs) {
  const groups = { local: [], remote: [], tag: [] };
  for (const r of refs) {
    if (r.type === 'remote' && /\/HEAD$/.test(r.refname)) continue; // origin/HEAD symref
    groups[r.type]?.push(r);
  }
  const fill = (ulId, countId, arr, cls) => {
    const ul = $(ulId); ul.innerHTML = '';
    $(countId).textContent = arr.length;
    for (const r of arr) {
      const li = document.createElement('li');
      if (r.isHead) li.classList.add('head');
      const dot = el('span', `dot ${cls === 'tag' ? 'tag' : (r.isHead ? 'head' : 'branch')}`);
      li.appendChild(dot);
      li.appendChild(el('span', 'label', r.short));
      if (r.isHead && state.aheadBehind && !state.aheadBehind.noUpstream) {
        const { ahead, behind } = state.aheadBehind;
        if (ahead || behind) li.appendChild(el('span', 'ab', `${ahead ? '↑' + ahead : ''}${behind ? '↓' + behind : ''}`));
      }
      li.appendChild(el('span', 'mini', (r.target || r.oid).slice(0, 7)));
      li.title = r.refname + (r.upstream ? ` → ${r.upstream}` : '') + '\n더블클릭: 체크아웃 · 우클릭: 메뉴';
      li.addEventListener('click', () => {
        const target = r.target || r.oid;
        const row = document.querySelector(`#commitList li[data-hash="${target}"]`);
        if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.click(); }
        else toast(`${r.short}의 커밋은 불러온 ${state.commits.length}개 밖에 있습니다.`, 'warn');
      });
      li.addEventListener('dblclick', () => { if (r.type !== 'tag' && !r.isHead) checkout(r.short); });
      li.addEventListener('contextmenu', (e) => refMenu(e, r));
      ul.appendChild(li);
    }
  };
  fill('localRefs', 'localCount', groups.local, 'local');
  fill('remoteRefs', 'remoteCount', groups.remote, 'remote');
  fill('tagRefs', 'tagCount', groups.tag, 'tag');
}

function renderStashes(stashes) {
  const ul = $('stashList');
  ul.innerHTML = '';
  $('stashCount').textContent = stashes.length;
  for (const s of stashes) {
    const li = document.createElement('li');
    li.appendChild(el('span', 'dot stash'));
    li.appendChild(el('span', 'label', s.message.replace(/^On [^:]+: /, '')));
    li.appendChild(el('span', 'mini', `{${s.index}}`));
    li.title = `${s.ref}: ${s.message}\n우클릭: apply / pop / drop`;
    li.addEventListener('contextmenu', (e) => stashMenu(e, s));
    li.addEventListener('click', (e) => stashMenu(e, s));
    ul.appendChild(li);
  }
}

function renderStatusSummary(status) {
  const n = status.count;
  $('status').innerHTML = n > 0
    ? `<span class="dirty">● ${n} change${n > 1 ? 's' : ''}</span>`
    : '<span class="clean">✓ clean</span>';
}

// ---- working area ------------------------------------------------------------------------

const XY_LABEL = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', U: '!', '?': '+', T: 'T' };

function fileRow(f, side) {
  const li = el('li', f.conflicted ? 'conflicted' : '');
  const code = f.conflicted ? '!' : side === 'staged' ? f.xy[0] : (f.untracked ? '?' : f.xy[1]);
  li.appendChild(el('span', `xy xy-${f.conflicted ? 'U' : code === '?' ? 'N' : code}`, XY_LABEL[code] || code));
  const name = el('span', 'fname', f.path);
  name.title = (f.origPath ? `${f.origPath} → ` : '') + f.path + (f.conflicted ? '\n충돌: 해결한 뒤 스테이징하세요' : '');
  li.appendChild(name);
  const acts = el('span', 'facts');
  if (side === 'unstaged') {
    if (!f.conflicted) {
      const d = el('button', 'icon danger-text', '↺');
      d.title = '변경 버리기';
      d.addEventListener('click', (e) => { e.stopPropagation(); runWrite('/api/discard', { paths: [f.path] }, { label: 'discard', success: `${f.path} 변경 버림` }); });
      acts.appendChild(d);
    }
    const s = el('button', 'icon', '+');
    s.title = f.conflicted ? '해결됨으로 표시 (스테이징)' : '스테이징';
    s.addEventListener('click', (e) => { e.stopPropagation(); runWrite('/api/stage', { paths: [f.path] }, { label: 'stage' }); });
    acts.appendChild(s);
    li.addEventListener('dblclick', () => runWrite('/api/stage', { paths: [f.path] }, { label: 'stage' }));
  } else {
    const u = el('button', 'icon', '−');
    u.title = '스테이징 취소';
    const paths = f.origPath ? [f.path, f.origPath] : [f.path];
    u.addEventListener('click', (e) => { e.stopPropagation(); runWrite('/api/unstage', { paths }, { label: 'unstage' }); });
    acts.appendChild(u);
    li.addEventListener('dblclick', () => runWrite('/api/unstage', { paths }, { label: 'unstage' }));
  }
  li.appendChild(acts);
  return li;
}

function renderWorkArea() {
  const st = state.status;
  $('workArea').hidden = !state.workOpen || !st;
  if (!st) return;
  const unstaged = st.files.filter((f) => f.unstaged);
  const staged = st.files.filter((f) => f.staged);
  const fill = (ulId, list, side, emptyMsg) => {
    const ul = $(ulId);
    ul.innerHTML = '';
    if (!list.length) ul.appendChild(el('li', 'empty-row', emptyMsg));
    for (const f of list) ul.appendChild(fileRow(f, side));
  };
  fill('unstagedList', unstaged, 'unstaged', '변경 없음');
  fill('stagedList', staged, 'staged', '스테이징된 파일 없음');
  $('unstagedCount').textContent = unstaged.length;
  $('stagedCount').textContent = staged.length;
  $('stageAllBtn').disabled = !unstaged.length;
  $('discardAllBtn').disabled = !unstaged.some((f) => !f.conflicted);
  $('unstageAllBtn').disabled = !staged.length;
  const op = state.opState && state.opState.op;
  $('commitBtn').textContent = op === 'merge' ? 'Commit (머지 완료)' : `Commit${staged.length ? ` (${staged.length})` : ''}`;
  $('waSummary').textContent = st.branchLine ? `· ${st.branchLine}` : '';
}

function renderOpBanner() {
  const s = state.opState;
  const banner = $('opBanner');
  if (!s || !s.op) { banner.hidden = true; return; }
  banner.hidden = false;
  const n = s.conflicts.length;
  $('opText').textContent = `⚠ ${s.op} 진행 중 — ` + (n
    ? `충돌 ${n}개: ${s.conflicts.slice(0, 4).join(', ')}${n > 4 ? ' …' : ''}. 해결 후 스테이징하고 계속하세요.`
    : '충돌이 모두 해결됐습니다. 계속을 눌러 마무리하세요.');
  $('opContinueBtn').disabled = n > 0;
}

function renderRemoteBar() {
  const ab = state.aheadBehind;
  $('remotebar').hidden = !state.repo;
  if (!ab) return;
  const setBadge = (id, n, ch) => { $(id).hidden = !n; $(id).textContent = `${ch}${n}`; };
  setBadge('aheadBadge', ab.ahead, '↑');
  setBadge('behindBadge', ab.behind, '↓');
  $('pullBtn').disabled = Boolean(ab.noUpstream);
  $('pullBtn').title = ab.noUpstream ? 'upstream이 없어 pull 할 수 없습니다' : `${ab.upstream}에서 pull`;
  $('pushBtn').title = ab.noUpstream ? 'upstream을 설정하며 push (git push -u)' : `${ab.upstream}(으)로 push`;
}

// ---- load --------------------------------------------------------------------------------

async function load() {
  if (desktop && !state.repoPath && !qsRepo()) {
    $('repoinfo').innerHTML = '<span class="hint">📂 열기 버튼으로 git 저장소 폴더를 선택하세요</span>';
    return;
  }
  try {
    const [repo, refs, commits, status, aheadBehind, opState, stashes] = await Promise.all([
      api('/api/repo'), api('/api/refs'), api('/api/commits', { limit: 400 }), api('/api/status'),
      api('/api/ahead-behind'), api('/api/op-state'), api('/api/stashes'),
    ]);
    if (repo.error) throw new Error(repo.error);
    const repoChanged = !state.repo || state.repo.path !== repo.path;
    Object.assign(state, { repo, refs, commits, status, aheadBehind, opState, stashes });

    $('repoinfo').innerHTML = `<b>${escapeHtml(repo.name)}</b> · on <b>${escapeHtml(repo.currentBranch)}</b> · ${commits.length} commits loaded`;
    $('repoInput').value = repo.path;

    renderStatusSummary(status);
    const { rows, laneCount } = layout(commits);
    const gw = drawGraph(rows, laneCount);
    renderList(rows, gw, refs);
    renderRefs(refs);
    renderStashes(stashes);
    renderWorkArea();
    renderOpBanner();
    renderRemoteBar();

    if (repoChanged || !commits.some((c) => c.hash === state.selected)) clearDetail();
    else {
      const li = document.querySelector(`#commitList li[data-hash="${state.selected}"]`);
      if (li) li.classList.add('selected');
    }
    $('sbLeft').textContent = repo.path;
    if (desktop) desktop.rememberRepo(repo.path);
  } catch (e) {
    $('repoinfo').innerHTML = e.message === 'no repo selected'
      ? '<span class="hint">repo 경로를 입력하세요</span>'
      : `<span class="error">${escapeHtml(e.message)}</span>`;
    Object.assign(state, { repo: null, status: null, opState: null, aheadBehind: null, stashes: [] });
    $('commitList').innerHTML = '';
    $('graph').innerHTML = '';
    for (const id of ['localRefs', 'remoteRefs', 'tagRefs', 'stashList']) $(id).innerHTML = '';
    clearDetail();
    renderWorkArea();
    renderOpBanner();
    $('remotebar').hidden = true;
  }
}

// ---- wiring ------------------------------------------------------------------------------

$('refreshBtn').addEventListener('click', load);
async function openRepoDialog() {
  const picked = await desktop.selectRepo();
  if (picked) { state.repoPath = picked; load(); }
}
if (desktop) {
  $('openBtn').hidden = false;
  $('openBtn').addEventListener('click', openRepoDialog);
  desktop.onOpenRepoRequest(openRepoDialog);
}
$('repoInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { state.repoPath = e.target.value.trim(); load(); }
});

$('status').addEventListener('click', () => { state.workOpen = !state.workOpen; renderWorkArea(); });
$('waCloseBtn').addEventListener('click', () => { state.workOpen = false; renderWorkArea(); });

$('stageAllBtn').addEventListener('click', () => runWrite('/api/stage', { all: true }, { label: 'stage' }));
$('unstageAllBtn').addEventListener('click', () => runWrite('/api/unstage', { all: true }, { label: 'unstage' }));
$('discardAllBtn').addEventListener('click', () => runWrite('/api/discard', { all: true }, { label: 'discard', success: '작업 트리 변경을 버렸습니다' }));

async function doCommit() {
  const message = $('commitMsg').value;
  const res = await runWrite('/api/commit', {
    message,
    amend: $('amendChk').checked,
    coAuthors: $('coAuthors').value.trim() || undefined,
  }, { label: 'commit', success: (r) => `커밋 ${r.hash.slice(0, 7)} 생성`, button: $('commitBtn') });
  if (res) { $('commitMsg').value = ''; $('amendChk').checked = false; }
}
$('commitBtn').addEventListener('click', doCommit);
$('commitMsg').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doCommit(); }
});
$('amendChk').addEventListener('change', async () => {
  if (!$('amendChk').checked || $('commitMsg').value.trim() || !state.repo || !state.repo.head) return;
  const d = await api('/api/commit', { hash: state.repo.head });
  if (!d.error) $('commitMsg').value = d.subject + (d.body ? `\n\n${d.body.trim()}` : '');
});

$('stashBtn').addEventListener('click', async () => {
  const v = await openDialog({
    title: '변경 사항 stash',
    fields: [
      { name: 'message', label: '메시지 (선택)' },
      { name: 'includeUntracked', label: '추적하지 않는 새 파일도 포함', type: 'checkbox', value: true },
    ],
    okLabel: 'Stash',
  });
  if (v) runWrite('/api/stash', v, { label: 'stash', success: 'stash에 저장했습니다' });
});

$('opContinueBtn').addEventListener('click', () => runWrite('/api/op/continue', {}, { label: 'continue', success: (r) => `${r.continued} 완료` }));
$('opAbortBtn').addEventListener('click', async () => {
  const op = state.opState && state.opState.op;
  const ok = await openDialog({ title: `${op} 중단`, message: `${op} 이전 상태로 되돌립니다. 충돌 해결 중이던 내용은 사라집니다.`, okLabel: '중단', danger: true });
  if (ok) runWrite('/api/op/abort', {}, { label: 'abort', success: (r) => `${r.aborted} 중단됨` });
});

$('fetchBtn').addEventListener('click', () => runWrite('/api/fetch', { all: true }, { label: 'fetch', success: 'fetch 완료', button: $('fetchBtn') }));
$('pullBtn').addEventListener('click', () => runWrite('/api/pull', {}, { label: 'pull', success: 'pull 완료', button: $('pullBtn') }));
const push = (extra = {}) => runWrite('/api/push', extra, {
  label: 'push', button: $('pushBtn'),
  success: (r) => `${r.remote}/${r.branch}(으)로 push${r.force ? ` (${r.force === 'lease' ? '--force-with-lease' : '--force'})` : ''}${r.setUpstream ? ' · upstream 설정' : ''}`,
});
$('pushBtn').addEventListener('click', () => push());
$('pushMoreBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, [
    { label: 'Push', action: () => push() },
    '-',
    { label: 'Force push (--force-with-lease)…', danger: true, action: () => push({ force: 'lease' }) },
    { label: 'Force push (--force)…', danger: true, action: () => push({ force: 'force' }) },
  ]);
});

load();
