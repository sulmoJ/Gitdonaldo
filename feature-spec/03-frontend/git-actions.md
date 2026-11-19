# git 작업 UI: 원격 바, 컨텍스트 메뉴, 확인 다이얼로그, 토스트, 작업 배너

근거: `public/app.js`의 `runWrite`, `openDialog`, `confirmDialog`, `openMenu`, `refMenu`, `commitMenu`, `stashMenu`, `renderRemoteBar`, `renderOpBanner`

## 공통 실행 흐름 `runWrite(ep, body)`

1. 다른 쓰기가 진행 중이면 막는다(`state.busy`). 하단바 오른쪽에 `⏳ <작업>…`, 네트워크 버튼에는 스피너.
2. `POST` → 428 `CONFIRM_REQUIRED`면 확인 다이얼로그를 띄우고, 확인하면 `confirmToken`(+`confirmText`, `acknowledgeForce`)을 붙여 다시 보낸다. 취소하면 아무것도 안 한다.
3. 성공: 성공 토스트 → `load()`로 **전체 재조회**(repo/refs/commits/status/ahead-behind/op-state/stashes). 응답의 `snapshot`은 아직 쓰지 않는다([sync B1](../06-roadmap/write-operations.md#b1-쓰기-후-ui-갱신)).
4. 실패: 에러 토스트(서버 `error` + `stderr`/`files`). `CONFLICT`·`OP_IN_PROGRESS`·`CONFIRM_INVALID`·`PUSH_REJECTED`는 상태가 바뀌었을 수 있어 다시 읽는다.

## 원격 바 (상단바)

`[⇣ Fetch] [⇩ Pull ↓n] [⇧ Push ↑n][▾]` — 레포가 열렸을 때만 보인다. 배지는 `/api/ahead-behind`.

| 버튼 | 동작 |
|---|---|
| Fetch | `POST /api/fetch { all: true }` |
| Pull | `POST /api/pull`. upstream이 없으면 비활성 |
| Push | `POST /api/push`. upstream이 없으면 `-u`로 설정하며 push(툴팁에 표시) |
| ▾ | 메뉴: Push / Force push (`--force-with-lease`)… / Force push (`--force`)… |

## 컨텍스트 메뉴 (우클릭)

| 대상 | 항목 |
|---|---|
| 로컬 브랜치(사이드바·커밋 칩) | 체크아웃, `<현재>`에 머지, 여기서 새 브랜치…, 여기에 태그…, 브랜치 삭제… (현재 브랜치는 체크아웃·머지·삭제 비활성) |
| 원격 브랜치 | 체크아웃(로컬 추적 브랜치 생성), `<현재>`에 머지, 여기서 새 브랜치… (`origin/HEAD`는 목록에서 숨김) |
| 태그 | 체크아웃(detached), 여기서 새 브랜치…, 태그 삭제… |
| 커밋 행 | 여기서 새 브랜치…, 체크아웃(detached), 여기에 태그…, `<현재>`에 cherry-pick, 커밋 되돌리기(revert), `<현재>`을(를) 여기로 reset — soft / mixed / hard… |
| stash(사이드바 STASHES, 클릭도 가능) | 적용(apply), 꺼내기(pop), 삭제(drop)… |

브랜치를 더블클릭하면 체크아웃한다. 사이드바 ref 클릭이 불러온 커밋 범위 밖이면 안내 토스트를 띄운다. 메뉴는 바깥 클릭·Esc·창 포커스 이탈로 닫힌다.

## 다이얼로그

- **입력 다이얼로그**: 브랜치 이름(+만든 뒤 체크아웃), 태그 이름·메시지, stash 메시지. Enter로 확인, Esc로 취소.
- **확인 다이얼로그**: 서버의 `confirm`을 그대로 보여준다(제목, 설명, 대상 목록 `details`).
  - `typed: true`(고위험): `CONFIRM`을 정확히 입력해야 확인 버튼이 켜진다(sync B4).
  - `checkbox`(순수 `--force`): 경고 체크박스도 켜야 한다.
  - 버튼 문구는 `confirm.action`(예: `버리기`, `Hard reset`, `Force push`).
- 작업 배너의 중단(Abort)은 클라이언트 쪽 확인 다이얼로그를 한 번 띄운다.

## 토스트

오른쪽 아래에 쌓인다. 성공(초록, 3.5초), 경고(주황), 에러(빨강, 10초, `stderr` 상세 포함). 클릭하면 닫힌다.

## 작업 배너(op banner)

`/api/op-state`의 `op`가 있으면(merge, revert, cherry-pick, rebase 진행 중) 상단바 아래에 노란 배너를 띄운다.

- 문구: `⚠ merge 진행 중 — 충돌 N개: a.txt, …` 또는 `충돌이 모두 해결됐습니다`.
- `계속 (Continue)`: 충돌이 남아 있으면 비활성. `POST /api/op/continue`.
- `중단 (Abort)`: 확인 후 `POST /api/op/abort`.
