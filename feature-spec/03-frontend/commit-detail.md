# 커밋 상세 패널

근거: `public/app.js:169-192`, `public/style.css` `#detail` 이하

## 동작

커밋 행을 클릭하면 `selectCommit(hash, li)`가 실행된다.

1. 기존 선택 행의 `selected` 클래스를 지우고 클릭한 행에 붙인다.
2. `state.selected = hash`
3. `/api/commit?hash=<hash>` 호출
4. "커밋을 선택하세요" 안내(`#detailEmpty`)를 숨기고 `#detailBody`를 채운다.

## 표시 항목

| 순서 | 항목 | 값 | 비고 |
|---|---|---|---|
| 제목 | `<h2>` | `subject` | HTML 이스케이프 |
| commit | 키-값 | 전체 해시 | 고정폭 글꼴 |
| parents | 키-값 | 부모 해시 앞 7자, 쉼표 구분. 없으면 `(root)` | 고정폭 글꼴 |
| author | 키-값 | `이름 <이메일>` | 이스케이프 |
| date | 키-값 | `authorDate`를 `ko-KR` 로캘 전체 날짜·시간으로 | 브라우저 시간대 |
| 본문 | `.body-text` 상자 | `body`, 줄바꿈 유지 | 본문이 있을 때만 |
| 파일 통계 | `.stat` | `stat` 텍스트, 공백 유지·가로 스크롤 | 비어 있으면 `(no file stats)` |

API가 주는 `committer`, `commitDate`는 표시하지 않는다.

## 이스케이프

`escapeHtml`이 `& < > "` 네 문자를 엔티티로 바꾼다. 커밋 메시지, 작성자, 이메일, stat처럼 사용자가 통제할 수 있는 문자열은 모두 이 함수를 거쳐 `innerHTML`에 들어간다. 해시와 부모 해시는 서버가 git 출력에서 받은 16진수라 이스케이프 없이 넣는다.

## 제약

- API 에러(`{error}`) 응답을 따로 처리하지 않는다. 필드가 비어 `undefined`, `Invalid Date` 등이 표시될 수 있다.
- 빠르게 여러 행을 클릭하면 응답 도착 순서대로 덮어써서, 마지막에 클릭한 커밋이 아닌 상세가 남을 수 있다.
- 레포를 새로 불러와도 상세 패널은 지우지 않는다.
- 파일별 diff 내용은 보여주지 않는다(stat 요약만).
