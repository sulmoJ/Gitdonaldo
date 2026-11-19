# 쓰기 기능 (M0~M3) · 구현 싱크 로그

> 상태: **완료(M0~M3 백엔드 + M1~M3 UI)** · 2026-11-19, Electron 데스크톱 앱이 들어간 master 기준으로 다시 구현했다.
> 확정 명세는 [api-write](../02-api/api-write.md), [working-area](../03-frontend/working-area.md), [git-actions](../03-frontend/git-actions.md), [security](../05-quality/security.md)로 옮겼다.
> 이 문서는 원래 쓰기 기능 스펙과 달라졌거나 스펙에 없던 결정을 기록한다.

## A. 구현 범위

- **백엔드(`server.js`)**
  - M0: 레포별 비동기 락(`withLock`), `gitRun`(stdin·timeout·마스킹), 에러 모델(`ApiError` → `{ error, code, ... }`), `snapshot`, confirmToken.
  - M1~M3: stage/unstage/discard/commit, branch/checkout/merge/op abort·continue/reset/revert/cherry-pick, tag/stash, fetch/pull/push. 읽기 `ahead-behind`, `op-state`, `stashes`, `remotes`, `snapshot` 추가.
- **UI(`public/`)**: 작업 영역(Unstaged·Staged 2열 + 커밋 박스), 원격 바(Fetch/Pull/Push + ahead/behind 배지, force push 메뉴), 확인·입력 다이얼로그, 토스트, op 배너, 브랜치/원격/태그/커밋/stash 컨텍스트 메뉴.
- **테스트**: `node --test` 32개(쓰기 21개 신규, `test/write.test.js`), Electron E2E 18개 항목(UI로 stage → commit, 토큰 없는 POST 403 추가).

## B. 원래 스펙과 달라진 점 (SYNC)

### B1. 쓰기 후 UI 갱신
- 스펙: 응답 `snapshot`으로 전체 reload 없이 부분 갱신.
- 구현: 쓰기 성공 후 클라이언트가 `load()`로 repo/refs/commits/status/ahead-behind/op-state/stashes를 **다시 조회**한다. 서버는 `snapshot`을 계속 반환한다.
- 이유: 정확성·단순성 우선(그래프 레인 재계산은 증분보다 전체가 안전). 400커밋 기준 체감 지연 수백 ms.
- 후속: 성능 문제가 생기면 `snapshot`으로 상태·작업 영역만 부분 갱신하는 경로를 추가한다.

### B2. 읽기 엔드포인트 추가
- `GET /api/ahead-behind` → `{ ahead, behind, upstream }`, upstream 없으면 `{ ahead:0, behind:0, noUpstream:true }`. push 배지와 pull 가능 여부에 쓴다.
- `GET /api/op-state` → `{ op: null|"merge"|"revert"|"cherry-pick"|"rebase", conflicts: [] }` (op 배너).
- `GET /api/stashes`, `GET /api/remotes`, `GET /api/snapshot`.

### B3. HEAD 없는 레포의 unstage
- 첫 커밋 전에는 `git reset`이 실패한다 → `git rm -r --cached --ignore-unmatch`로 분기한다. HEAD가 있으면 `git reset -q HEAD -- <paths>`.

### B4. "타이핑 확인" 문구
- 스펙: "원격명/브랜치명 입력".
- 구현: 고위험(force push, hard reset, 미병합 branch delete)은 **`CONFIRM` 고정 문자열**. 이름 오타로 인한 재입력 마찰을 줄이고, 의도 확인이라는 목적은 같다.
- 추가: 서버도 `confirmText === "CONFIRM"`을 검사한다(UI 우회 방지).

### B5. confirmToken 상태해시
- `sha256(HEAD + "status --porcelain" + show-ref)`로 확정. 토큰은 `만료.HMAC(op, 레포, 파라미터, 상태해시, 만료)`, 5분, 비밀키는 서버 실행마다 새로 만든다(서버 재시작 시 기존 토큰 무효).

### B6. (신규) `/api/commit` 메서드 겸용
- 기존 읽기 `GET /api/commit?hash=`(커밋 상세)와 쓰기 `POST /api/commit`(커밋 생성)을 메서드로 구분한다. 다른 쓰기 경로는 POST만 받는다.

### B7. (신규) 확인 응답 코드 428
- 1단계 응답은 HTTP **428 Precondition Required** + `code: CONFIRM_REQUIRED`. 브라우저 콘솔에 "Failed to load resource 428"이 찍히지만 정상 흐름이다.

### B8. (신규) 쓰기 CSRF 방어
- 쓰기는 `POST` + `content-type: application/json`만 받는다. 브라우저 모드(토큰 없음)에서도 다른 출처 페이지가 보내면 CORS 사전 요청에서 막힌다.

### B9. (신규) `/api/status` 응답 확장 — 호환성 변경
- `git status --porcelain=v1 -z`로 파싱해 공백·따옴표·비ASCII 경로가 깨지지 않는다.
- 파일마다 `staged`, `unstaged`, `untracked`, `conflicted` 불리언 추가.
- **이름 변경**: `path`가 `"old -> new"` 문자열이던 것을 `path: "new"`, `origPath: "old"`로 나눴다.
- 추적 안 하는 디렉터리는 디렉터리 하나가 아니라 파일 단위로 나온다(`--untracked-files=all`).

### B10. (신규) 함께 고친 알려진 이슈
- 주석 태그 peel: `/api/refs`에 `target`(가리키는 커밋) 추가, 그래프 칩·사이드바 이동이 동작한다(#1).
- 400커밋 밖 ref 클릭 시 안내 토스트(#2). 레포 로딩 실패 시 사이드바·상세 초기화(#3), 사라진 커밋의 상세 초기화(#4), 상세 응답 순서 보장·에러 표시(#5, #6).
- 입력 검증 실패는 400(#7). detached HEAD는 `currentBranch: "(detached)"`(#8, `symbolic-ref` 사용). `server.js` shebang(#10). `log`의 무의미한 `--topo-order` 제거(#13).

## C. 스펙대로 지킨 핵심

- 레포별 락 직렬화 — 동시 `git add` 8개가 `index.lock` 충돌 없이 모두 성공하는 테스트.
- 파괴적 op 2단계 토큰(discard / reset-hard / branch-delete / tag-delete / stash-drop / push-force) — 토큰 위조·파라미터 바꿔치기·상태 변경 테스트.
- force push 기본 `--force-with-lease`, 순수 `--force`는 opt-in + 2차 경고 체크박스(`acknowledgeForce`).
- 자격증명 비저장: `GIT_TERMINAL_PROMPT=0`, credential helper / ssh-agent 위임. 에디터·페이저도 끈다(`GIT_EDITOR=true`, `GIT_PAGER=cat`).
- stderr 비밀 마스킹: URL 자격정보, `x-access-token`, GitHub/GitLab 토큰 패턴, Authorization 헤더.
- 커밋·태그 메시지는 stdin(`-F -`), 모든 git 호출은 인자 배열(셸 미경유). 사용자 입력 ref는 `-`로 시작하면 거부하고 `--end-of-options`/`--`로 구분, 경로는 `--literal-pathspecs`.

## D. 아직 안 한 것

- hunk 단위 스테이징, diff 뷰어(커밋 상세는 `--stat`만), GPG 서명 토글.
- 대화형 rebase, PR 연동(OAuth) — 별도 트랙(비범위 유지).
- 증분 snapshot 적용(B1), 네트워크 작업 진행률(현재는 버튼 스피너만).
- 브랜치 이름 변경, 원격 브랜치 삭제, 태그 push.
- ssh 호스트키·패스프레이즈 프롬프트는 막지 않는다(타임아웃 120초로만 보호).
