# 화면 레이아웃과 초기 로딩

근거: `public/index.html`, `public/app.js:235-268`, `public/style.css`

## 화면 구성

```
┌──────────────────────────── #topbar (46px) ─────────────────────────────┐
│ 🔀 Gitdonaldo │ <레포명> · on <브랜치> · N commits │ [📂 열기][경로 입력][⟳] │
├──────────────┬──────────────────────────────────────────┬───────────────┤
│ #sidebar     │ #graphpane                               │ #detail       │
│ 230px        │ 1fr                                      │ 320px         │
│ WORKING DIR  │ [그래프][ref칩][제목]  [작성자][날짜][해시]  │ 커밋 상세     │
│ LOCAL   (n)  │  ...                                     │               │
│ REMOTE  (n)  │                                          │               │
│ TAGS    (n)  │                                          │               │
├──────────────┴──────────────────────────────────────────┴───────────────┤
│ #statusbar (24px)  <레포 경로>                               Gitdonaldo │
└─────────────────────────────────────────────────────────────────────────┘
```

| 영역 | 요소 | 내용 | 상세 명세 |
|---|---|---|---|
| 상단바 | `#topbar` | 브랜드, 레포 정보(`#repoinfo`), 폴더 열기(`#openBtn`, 데스크톱 앱만), 경로 입력(`#repoInput`), 새로고침(`#refreshBtn`) | [repo-selection](./repo-selection.md) |
| 좌측 | `#sidebar` | Working dir 상태, Local/Remote/Tags 목록 | [refs-sidebar](./refs-sidebar.md) |
| 중앙 | `#graphpane` | SVG 그래프(`#graph`) + 커밋 행(`#commitList`), 아래에 작업 영역(`#workArea`, 280px) | [commit-graph](./commit-graph.md), [working-area](./working-area.md) |
| 상단 | `#remotebar`, `#opBanner` | Fetch/Pull/Push, 진행 중 merge 등의 배너 | [git-actions](./git-actions.md) |
| 우측 | `#detail` | 선택 전 "커밋을 선택하세요", 선택 후 상세 | [commit-detail](./commit-detail.md) |
| 하단바 | `#statusbar` | 왼쪽 레포 경로(`#sbLeft`), 오른쪽 고정 문구 | — |

- 페이지 전체는 `100vh` 고정, `body`는 스크롤하지 않는다. 사이드바·그래프·상세 영역이 각자 스크롤한다.
- 3열 그리드 폭이 고정이라 좁은 화면 대응(반응형)은 없다. 데스크톱 앱 창은 최소 960×600, 기본 1320×840.
- 문서 언어 `lang="ko"`, UI 문구는 한국어와 영어 섹션 제목을 섞어 쓴다.

## 초기 로딩 `load()`

페이지 로드 직후 한 번, 새로고침 버튼과 경로 입력 Enter 때마다 실행한다.

0. 데스크톱 앱이고 지정된 레포가 없으면 안내 문구만 보이고 끝낸다 ([repo-selection](./repo-selection.md#레포를-아직-고르지-않았을-때)).
1. API 7개 병렬 호출: `/api/repo`, `/api/refs`, `/api/commits?limit=400`, `/api/status`, `/api/ahead-behind`, `/api/op-state`, `/api/stashes`. 쓰기 작업이 성공할 때마다 이 과정을 다시 돈다.
2. `repo.error`가 있으면 에러 처리로 넘어간다.
3. 클라이언트 상태(`state.repo`, `state.refs`, `state.commits`) 갱신
4. 상단 `#repoinfo`: `<b>이름</b> · on <b>브랜치</b> · N commits loaded`
5. 입력창 값을 서버가 알려준 레포 최상위 경로로 바꾼다.
6. Working dir 상태 표시 ([refs-sidebar](./refs-sidebar.md))
7. `layout()` → `drawGraph()` → `renderList()` → `renderRefs()`
8. 하단 `#sbLeft`에 레포 경로
9. 데스크톱 앱이면 `rememberRepo(경로)`로 마지막 레포 저장

### 에러 시

- `#repoinfo`에 에러 메시지를 빨간색(`.error`, `#f0768b`)으로 표시. CSP 때문에 인라인 `style` 속성 대신 클래스를 쓴다.
- 커밋 목록과 그래프를 비운다.
- 사이드바(브랜치·태그·stash), 상세 패널, 작업 영역도 비우고 원격 바를 숨긴다.

## 클라이언트 상태

`public/app.js:11`

| 키 | 의미 |
|---|---|
| `repo` | 마지막 `/api/repo` 응답 |
| `commits` | 마지막 커밋 목록 |
| `refs` | 마지막 ref 목록 |
| `selected` | 선택한 커밋 해시 |
| `repoPath` | 입력창으로 지정한 레포 경로(없으면 `undefined`) |

프레임워크 없이 DOM을 직접 조작한다. 상태가 바뀌면 해당 영역을 통째로 다시 그린다.
