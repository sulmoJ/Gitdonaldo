# 사이드바: 작업 트리 상태와 ref 목록

근거: `public/index.html:21-38`, `public/app.js:200-233`, `public/app.js:250-253`

## WORKING DIR

`/api/status`의 `count`로 작업 트리 상태를 한 줄로 보여준다.

| 조건 | 표시 | 색 |
|---|---|---|
| `count === 0` | `✓ clean` | 초록(`--accent2`) |
| `count === 1` | `● 1 change` | 주황(`#f0b457`) |
| `count > 1` | `● N changes` | 주황 |

변경 파일 목록(`files`)과 브랜치 추적 정보(`branchLine`)는 API가 내려주지만 화면에는 표시하지 않는다.

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
