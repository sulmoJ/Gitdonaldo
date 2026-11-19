# 작업 영역(Working area): 스테이징과 커밋

근거: `public/index.html`(`#workArea`), `public/app.js`의 `renderWorkArea`, `fileRow`, `doCommit`

그래프 아래에 붙는 패널(높이 280px)이다. 레포를 열면 기본으로 보이고, 사이드바 WORKING DIR 상태 줄을 클릭하거나 패널의 ✕로 열고 닫는다.

```
┌ 변경 사항 · main...origin/main [ahead 1] ───────────────────────────── ✕ ┐
│ Unstaged (n) [모두 버리기][모두 스테이징] │ Staged (n) [모두 내리기] │ 커밋 메시지        │
│  M a.txt                     ↺ +        │  A b.txt              − │ Co-author 입력      │
│  + new.txt                   ↺ +        │                         │ ☐ amend            │
│  ! conflict.txt                +        │                         │ [Stash…] [Commit]   │
└───────────────────────────────────────────────────────────────────────────┘
```

## 파일 목록

`/api/status`의 `files`를 쓴다.

| 열 | 포함 조건 | 표시 코드 |
|---|---|---|
| Unstaged | `unstaged`(작업 트리 변경, 새 파일, 충돌) | Y 글자. 새 파일 `+`, 충돌 `!`(빨강) |
| Staged | `staged` | X 글자 |

부분 스테이징된 파일(`MM`)은 양쪽에 다 나온다. 경로가 길면 앞부분을 줄인다(`direction: rtl`). 이름 변경은 툴팁에 `old → new`.

| 동작 | 방법 | API |
|---|---|---|
| 스테이징 | 행의 `+`, 행 더블클릭, `모두 스테이징` | `POST /api/stage` |
| 충돌 해결 표시 | 충돌 행의 `+` | `POST /api/stage` |
| 스테이징 취소 | 행의 `−`, 행 더블클릭, `모두 내리기` | `POST /api/unstage` (이름 변경은 두 경로) |
| 변경 버리기 | 행의 `↺`, `모두 버리기` | `POST /api/discard` → 확인 다이얼로그 |

행 버튼은 마우스를 올렸을 때만 보인다.

## 커밋 박스

- 메시지(`#commitMsg`): 첫 줄이 제목. `Ctrl/Cmd+Enter`로 커밋.
- Co-author(`#coAuthors`): `이름 <email>`을 쉼표로 여러 명. 커밋 후에도 값을 유지한다(페어 작업용).
- amend(`#amendChk`): 켤 때 메시지가 비어 있으면 HEAD 커밋 메시지를 채운다.
- Commit 버튼 문구: `Commit (스테이징 수)`, merge 진행 중이면 `Commit (머지 완료)`.
- 사전 검사 실패(422)는 서버 메시지를 토스트로 보여준다. 성공하면 메시지·amend를 비우고 전체를 다시 읽는다.
- Stash…: 메시지와 "추적하지 않는 새 파일도 포함"(기본 켬)을 묻는 다이얼로그 → `POST /api/stash`.
