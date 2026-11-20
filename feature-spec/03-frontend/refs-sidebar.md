# 사이드바: 작업 트리 상태와 ref 목록

근거: `public/index.html`의 `#sidebar`, `public/app.js`의 `renderRefs`, `refTree`, `renderTree`, `applySection`

## WORKING DIR

`/api/status`의 `count`로 작업 트리 상태를 한 줄로 보여준다.

| 조건 | 표시 | 색 |
|---|---|---|
| `count === 0` | `✓ clean` | 초록(`--accent2`) |
| `count === 1` | `● 1 change` | 주황(`#f0b457`) |
| `count > 1` | `● N changes` | 주황 |

이 줄을 클릭하면 그래프 아래 [작업 영역](./working-area.md)을 열고 닫는다. 현재 브랜치 항목에는 upstream 대비 `↑ahead↓behind`를 붙인다.

## 우클릭·더블클릭

브랜치·태그 우클릭 메뉴와 더블클릭 체크아웃은 [git-actions](./git-actions.md#컨텍스트-메뉴-우클릭). 사이드바 맨 아래 STASHES 목록도 같은 문서에 있다.

## 섹션 접기

LOCAL / REMOTE / TAGS / STASHES 섹션은 **기본적으로 접혀 있다**. 제목(▸ 삼각형 + 이름 + 개수)을 클릭하거나 Enter/Space로 펼치고 접는다. WORKING DIR은 접지 않는다.

- 펼침 상태는 브라우저 `localStorage`(`gitdonaldo.sidebar.expanded`)에 viewer별로 저장해 새로고침·재실행 후에도 유지한다. 저장소를 쓸 수 없으면 기본값(접힘)으로 동작한다.
- ref를 드래그하는 중 접힌 섹션 제목이나 폴더 위에 0.6초 머무르면 자동으로 펼쳐진다(드롭 대상을 찾기 위해).

## 브랜치 폴더 (`/` 기준)

로컬·원격 브랜치는 이름을 `/`로 나눠 폴더 트리로 보여준다. 원격은 `origin/feature/x` → `origin` ▸ `feature` ▸ `x`처럼 원격 이름이 최상위 폴더가 된다. 태그는 평평한 목록 그대로다.

- 폴더 행: `[▸] [📁/📂] [이름] ……… [하위 브랜치 수]`, 같은 단계에서 폴더가 먼저, 그다음 브랜치. 폴더는 이름순.
- 깊이마다 14px 들여쓴다. 브랜치 행에는 마지막 경로 조각만 표시하고, 툴팁에 전체 ref 이름.
- 폴더 기본값은 접힘. 단, 현재 브랜치를 담은 폴더는 기본으로 펼쳐지며, 접혀 있으면 폴더 이름이 초록색으로 표시된다.
- 폴더를 클릭하면 펼치고 접는다(상태는 위와 같은 저장소, 키 `dir:<type>:<경로>`).

## LOCAL / REMOTE / TAGS

`renderRefs(refs)`가 `/api/refs` 결과를 `type`별로 나눠 세 목록에 넣는다. 순서는 API 응답 순서(refname 사전순)다.

- 섹션 제목 옆 알약(`.pill`)에 개수 표시
- 항목 구성: `[색 점] [축약 이름] ……… [oid 앞 7자]`
- 마우스를 올리면 툴팁으로 전체 ref 이름(`refs/heads/main` 등)

| 조건 | 점 색 | 글자 |
|---|---|---|
| 태그 | `#f0b457` 주황 | 기본 |
| 현재 브랜치(`isHead`) | `#6ee7b7` 초록 | 초록, 굵게 |
| 그 외 브랜치 | `#46a6ff` 파랑 | 기본 |

이름이 길면 말줄임(`text-overflow: ellipsis`)한다.

## ref 클릭 → 커밋 이동

1. 커밋 목록에서 `li[data-hash="<oid>"]`를 찾는다.
2. 있으면 화면 가운데로 부드럽게 스크롤(`scrollIntoView({block:'center', behavior:'smooth'})`)한 뒤 그 행을 클릭해 상세를 연다.
3. 없으면 아무 일도 하지 않는다.

다음 경우 행을 찾지 못한다.

- ref가 가리키는 커밋이 로드된 400개 밖에 있을 때
- 주석 태그: `oid`가 커밋이 아니라 태그 객체 해시라서

두 경우 모두 사용자에게 알림이 없다 ([알려진 이슈](../05-quality/constraints-and-known-issues.md)).
