# 쓰기 API (M0~M3)

저장소 상태를 바꾸는 엔드포인트다. 읽기 API는 [api-endpoints.md](./api-endpoints.md), 공통 규약은 [api-conventions.md](./api-conventions.md).
근거: `server.js`의 `WRITES` 표와 `op*` 함수, 테스트 `test/write.test.js`.

## 공통

- 메서드 `POST`, 헤더 `content-type: application/json`, 본문은 JSON 객체(최대 1 MiB). 아니면 405 / 415 / 400.
  - JSON content-type은 CORS 사전 요청을 일으키고 서버는 사전 요청에 답하지 않는다. 그래서 토큰이 없는 브라우저 모드에서도 다른 출처 페이지는 쓰기를 보낼 수 없다.
- 대상 레포: `?repo=` → 본문 `repo` → 서버 기본값 순.
- **레포별 락**: 같은 레포(작업 트리 최상위 경로 기준)의 쓰기는 한 번에 하나씩 순서대로 실행한다(`withLock`). 읽기는 락을 잡지 않는다. 쓰기 응답의 `snapshot`도 락 안에서 만든다. 모든 git 호출은 `GIT_OPTIONAL_LOCKS=0`으로 실행해, 락 밖에서 도는 읽기(`git status`)가 `index.lock`을 잠깐 잡아 동시에 실행 중인 쓰기(`git add` 등)를 실패시키지 않게 한다.
- 성공 응답 200:

  ```json
  { "ok": true, "result": { ... }, "snapshot": { "repo": {}, "status": {}, "refs": [], "opState": {}, "aheadBehind": {}, "stashes": [] } }
  ```

  `snapshot`은 쓰기 직후 상태다. 현재 UI는 이 값을 증분 적용하지 않고 모든 읽기 API를 다시 부른다([sync B1](../06-roadmap/write-operations.md#b1-쓰기-후-ui-갱신)).

### 에러 모델

본문은 항상 `{ "error": "<사람이 읽는 문구>", "code": "<기계용 코드>", ...추가필드 }`.

| HTTP | code | 의미 | 추가 필드 |
|---|---|---|---|
| 400 | `BAD_REQUEST` | 입력 형식 오류(이름, 해시, 경로, 본문) | — |
| 400 | `NO_REPO` / `NOT_A_REPO` | 레포 없음 / git 작업 트리 아님 | — |
| 400 | `CONFIRM_TEXT_REQUIRED` | 고위험 작업에 `confirmText: "CONFIRM"` 누락 | — |
| 400 | `FORCE_NOT_ACKNOWLEDGED` | 순수 `--force`에 `acknowledgeForce: true` 누락 | — |
| 401 | `AUTH_REQUIRED` | 원격 인증 실패(자격증명 helper/ssh-agent 미설정) | `stderr` |
| 405 / 415 | `METHOD_NOT_ALLOWED` / `BAD_REQUEST` | POST·JSON 아님 | — |
| 409 | `DIRTY_WORKTREE` | 커밋 안 한 변경 때문에 checkout/merge/revert/cherry-pick 불가(추적 안 하는 새 파일은 허용) | `files` |
| 409 | `OP_IN_PROGRESS` | merge/revert/cherry-pick/rebase 진행 중 | `opState` |
| 409 | `CONFLICT` | 실행 중 충돌 발생. 저장소는 충돌 상태로 남는다 | `opState`, `snapshot`, `stderr` |
| 409 | `ALREADY_EXISTS` | 같은 이름 브랜치/태그 존재 | — |
| 409 | `PUSH_REJECTED` | non-fast-forward 또는 `--force-with-lease` 거부 | `stderr` |
| 409 | `CONFIRM_INVALID` / `CONFIRM_EXPIRED` | 확인 토큰이 틀림·상태 변경됨 / 5분 경과 | — |
| 422 | `PRECHECK_FAILED` | 사전 검사 실패(빈 메시지, 스테이징 없음 등) | `problems`(커밋) |
| 422 | `NO_UPSTREAM` | upstream 없는 브랜치에서 pull | — |
| 428 | `CONFIRM_REQUIRED` | 파괴적 작업의 1단계 응답 | `confirmToken`, `confirm` |
| 502 | `REMOTE_UNREACHABLE` | 원격 연결 실패 | `stderr` |
| 504 | `TIMEOUT` | git 시간 초과(로컬 30초, 네트워크 120초) | `stderr` |
| 500 | `GIT_FAILED` / `INTERNAL` | 그 밖의 실패 | `stderr` |

`stderr`는 항상 자격정보를 가린 값이다(`https://user:pass@` → `https://***:***@`, `x-access-token:…@`, `ghp_…` 등).

### 2단계 확인(confirmToken)

파괴적 작업(discard, reset --hard, branch delete, tag delete, stash drop, force push)은 두 번 호출한다.

1. `confirmToken` 없이 호출 → **428** `CONFIRM_REQUIRED`

   ```json
   {
     "error": "변경 사항 버리기", "code": "CONFIRM_REQUIRED",
     "confirmToken": "1763520000000.Qm9...",
     "confirm": { "title": "...", "message": "...", "details": ["M  a.txt"], "risk": "medium|high",
                  "typed": true, "checkbox": "...", "action": "버리기" }
   }
   ```
2. 같은 본문에 `confirmToken`(고위험이면 `confirmText: "CONFIRM"`, 순수 force push면 `acknowledgeForce: true`도)을 붙여 다시 호출.

토큰 = `만료시각.HMAC-SHA256(서버 실행별 비밀, [op, 레포, 파라미터, 상태해시, 만료시각])`.
상태해시 = `sha256(HEAD + "status --porcelain" + show-ref)`. 그래서 다이얼로그를 띄운 뒤 파일이 바뀌거나 ref가 움직이면, 또는 다른 파라미터에 토큰을 쓰면 `CONFIRM_INVALID`가 된다. 유효기간 5분.

| `confirm.risk` | 작업 | UI |
|---|---|---|
| `medium` | discard, 병합된 branch delete, tag delete, stash drop | 확인 버튼 |
| `high` (`typed: true`) | reset --hard, 병합 안 된 branch delete, force push | `CONFIRM` 입력해야 버튼 활성. 순수 `--force`는 경고 체크박스(`checkbox`)도 |

---

## 엔드포인트

| 엔드포인트 | 본문 | 확인 | `result` |
|---|---|---|---|
| `POST /api/stage` | `{ paths: string[] }` 또는 `{ all: true }` | — | `{}` |
| `POST /api/unstage` | 같음 | — | `{}` |
| `POST /api/discard` | 같음 | 2단계 | `{ discarded }` |
| `POST /api/commit` | `{ message, amend?, coAuthors?, allowEmpty? }` | — | `{ hash }` |
| `POST /api/branch` | `{ name, start?, checkout? }` | — | `{ name }` |
| `POST /api/branch/delete` | `{ name }` | 2단계(미병합은 high) | `{ name, merged }` |
| `POST /api/checkout` | `{ ref, detach? }` | — | `{ branch }` / `{ branch, tracking }` / `{ detached }` |
| `POST /api/merge` | `{ ref, into?, noFF?, ffOnly? }` | — | `{ into, switched, fastForward, upToDate }` |
| `POST /api/rebase` | `{ branch, onto }` | 이미 upstream에 올라간 커밋을 다시 쓸 때만 2단계(high) | `{ branch, onto, rewritten, hash }` / `{ upToDate }` |
| `POST /api/op/abort` | `{}` | — | `{ aborted }` |
| `POST /api/op/continue` | `{}` | — | `{ continued }` |
| `POST /api/reset` | `{ target, mode: soft\|mixed\|hard }` | hard만 2단계(high) | `{ mode, target }` |
| `POST /api/revert` | `{ hash, mainline? }` | — | `{ hash }` |
| `POST /api/cherry-pick` | `{ hash, mainline? }` | — | `{ hash }` |
| `POST /api/tag` | `{ name, target?, message? }` | — | `{ name, annotated }` |
| `POST /api/tag/delete` | `{ name }` | 2단계 | `{ name }` |
| `POST /api/stash` | `{ message?, includeUntracked? }` | — | `{}` |
| `POST /api/stash/apply` · `/pop` | `{ index }` | — | `{}` |
| `POST /api/stash/drop` | `{ index }` | 2단계 | `{}` |
| `POST /api/fetch` | `{ remote? , all? }` | — | `{}` |
| `POST /api/pull` | `{ ffOnly? }` | — | `{}` |
| `POST /api/push` | `{ remote?, force?: "lease"\|"force" }` | force만 2단계(high) | `{ remote, branch, setUpstream, force }` |

> `/api/commit`은 `GET`(커밋 상세, 읽기)과 `POST`(커밋 생성, 쓰기)를 메서드로 구분한다.

### 동작 세부

- **stage**: `git --literal-pathspecs add -A -- <paths>` / `git add -A`. 삭제된 파일도 스테이징된다.
- **unstage**: HEAD가 있으면 `git reset -q HEAD -- <paths>`, 첫 커밋 전(HEAD 없음)에는 `git rm -r --cached --ignore-unmatch -- <paths|.>`. 이름 변경은 새 경로와 `origPath`를 함께 보낸다.
- **discard**: 작업 트리 변경(`unstaged`)만 되돌린다. 추적 파일은 `git checkout -- <paths>`(인덱스 상태로), 새 파일은 `git clean -f -- <paths>`(삭제). 충돌 파일·스테이징만 된 변경은 건드리지 않는다. 대상이 없으면 422.
- **commit**: 사전 검사 → `git commit -q --cleanup=strip -F -`(메시지는 stdin).
  - 검사 항목(`problems[].check`): `message`(빈 메시지), `identity`(`git var GIT_COMMITTER_IDENT` 실패), `conflicts`(미해결 충돌), `amend`(이전 커밋 없음), `staged`(스테이징 없음 — amend·allowEmpty·merge 진행 중이면 생략).
  - `coAuthors`: `"이름 <email>"` 문자열 배열, 쉼표/줄바꿈 구분 문자열, 또는 `{ name, email }` 배열. 메시지 끝에 `Co-authored-by:` 트레일러로 붙인다(이미 있는 줄은 중복 추가 안 함). 형식이 틀리면 400.
- **branch**: 이름은 `git check-ref-format --branch`로 검증, `-`로 시작하면 거부. `start`는 커밋으로 해석돼야 한다. `checkout: true`면 깨끗한 작업 트리가 필요하다.
- **branch/delete**: 현재 체크아웃된 브랜치는 지울 수 없다(409 `PRECHECK_FAILED`). 병합 여부는 upstream이 있으면 upstream, 없으면 HEAD 기준 `merge-base --is-ancestor`. 병합됐으면 `-d`, 확인 후 미병합이면 `-D`.
- **checkout**: 진행 중 작업이 없고 작업 트리가 깨끗해야 한다(새 파일은 허용).
  - 로컬 브랜치 이름 → 그 브랜치. 원격 브랜치(`origin/foo`) → 로컬 `foo`가 있으면 그것, 없으면 `git checkout -b foo --track origin/foo`. 그 밖의 리비전 또는 `detach: true` → detached HEAD.
- **merge**: `git merge --no-edit [--ff-only|--no-ff] --end-of-options <ref>`. 충돌 시 409 `CONFLICT`, 저장소는 merge 상태로 남는다 → `/api/op/abort` 또는 충돌 해결·스테이징 후 `/api/op/continue`.
- **merge `into`**: 로컬 브랜치 이름. 현재 브랜치와 다르면 — 이미 포함됐으면 `upToDate`, fast-forward 가능하고 `noFF`가 아니면 `git update-ref`로 체크아웃 없이 이동, 그 밖은(`ffOnly`면 409 `PRECHECK_FAILED`) 깨끗한 작업 트리를 확인한 뒤 `into`를 체크아웃하고 머지한다(`switched: true`).
- **rebase**: `git rebase <onto의 커밋 oid> <branch>`. `onto`가 이미 `branch`의 조상이면 아무것도 하지 않고 `upToDate`. 깨끗한 작업 트리가 필요하다. `branch`에 upstream이 있고 다시 쓰는 커밋(`onto..branch`) 중 upstream에 있는 것이 있으면 확인 토큰을 요구한다. 충돌 시 409 `CONFLICT`, 저장소는 rebase 상태 → `/api/op/continue`(`git rebase --continue`) 또는 `/api/op/abort`.
- **op/continue**: 충돌이 남아 있으면 422. merge는 `git commit --no-edit`, 그 밖은 `git <op> --continue`.
- **reset**: `git reset -q --<mode> <target>`. hard는 사라질 변경 목록을 `confirm.details`로 보여준다.
- **revert / cherry-pick**: 깨끗한 작업 트리 필요. 머지 커밋이면 `-m <mainline>`(기본 1). 충돌 시 409 `CONFLICT`.
- **tag**: `message`가 있으면 주석 태그(`git tag -a -F -`), 없으면 경량 태그.
- **stash**: 변경이 없으면 422. `includeUntracked`면 `--include-untracked`. apply/pop 충돌은 409 `CONFLICT`.
- **fetch**: `git fetch --prune <remote|--all>`. 원격 기본값은 `origin`(없으면 첫 원격).
- **pull**: upstream 필요(없으면 422 `NO_UPSTREAM`). `git pull --no-rebase --no-edit`(또는 `--ff-only`). 충돌 시 409.
- **push**: detached HEAD면 422. upstream이 없으면 `--set-upstream <remote> HEAD:refs/heads/<branch>`.
  `force: "lease"` → `--force-with-lease`(기본 force 방식), `force: "force"` → 순수 `--force`(2차 체크박스 필요). 거부되면 409 `PUSH_REJECTED`.

### 자격증명

Gitdonaldo는 자격증명을 묻거나 저장하지 않는다. 모든 git 실행에 `GIT_TERMINAL_PROMPT=0`을 주고, 인증은 사용자의 credential helper(macOS 키체인 등)와 ssh-agent에 맡긴다. 실패하면 401 `AUTH_REQUIRED`로 안내한다.
