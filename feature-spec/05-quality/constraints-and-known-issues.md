# 제약, 알려진 이슈, 향후 과제

v0.1.0(커밋 `f042d13`) 코드 검토와 실제 API 호출로 확인한 내용이다.

## 설계상 제약

| 항목 | 내용 |
|---|---|
| 커밋 수 | 화면은 최근 400개만 로드한다(API 최대 2000). 더 보기·페이지네이션 없음 |
| 갱신 | 수동 새로고침만 지원. 파일 감시·폴링 없음 |
| 읽기 전용 | checkout, fetch 등 쓰기 작업 없음 |
| 화면 | 고정 3열 레이아웃, 반응형·라이트 모드 없음 |
| 기능 | 검색·필터, 파일별 diff, blame, stash 목록 없음 |
| 실행 환경 | 시스템 `git` 필요. Node 18+ |

## 알려진 이슈

| # | 영역 | 증상 | 원인 | 근거 |
|---|---|---|---|---|
| 1 | 그래프/사이드바 | 주석 태그가 커밋 행에 칩으로 안 붙고, 사이드바에서 클릭해도 이동하지 않음 | `for-each-ref`의 `%(objectname)`이 태그 객체 해시. `%(*objectname)`(peel)을 쓰지 않음 | `server.js:47-50` |
| 2 | 사이드바 | 400개 밖 커밋을 가리키는 ref를 클릭해도 반응 없음 | 로드된 행에서만 찾음. 안내 없음 | `public/app.js:217-220` |
| 3 | 로딩 | 잘못된 경로로 바꾸면 사이드바와 상세 패널에 이전 레포 내용이 남음 | 에러 처리에서 목록·그래프만 비움 | `public/app.js:250-254` |
| 4 | 상세 | 레포를 바꾸거나 새로고침해도 이전에 선택한 커밋 상세가 남음 | `load()`가 상세 패널을 초기화하지 않음 | `public/app.js:229` |
| 5 | 상세 | 빠르게 연속 클릭하면 늦게 도착한 응답이 화면을 덮어씀 | 요청 순서 확인 없음 | `public/app.js:169-187` |
| 6 | 상세 | API 에러 시 `undefined`, `Invalid Date` 표시 | `d.error` 처리 없음 | `public/app.js:173` |
| 7 | API | 잘못된 해시 형식이 400이 아닌 500 | 검증 실패도 일반 예외로 처리 | `server.js:103` |
| 8 | 레포 정보 | detached HEAD일 때 브랜치명이 `HEAD`로 표시됨(`(detached)` 아님) | `rev-parse --abbrev-ref HEAD`가 성공하며 `HEAD`를 출력 | `server.js:40` |
| 9 | 그래프 | 여러 행을 건너는 간선이 하나의 긴 곡선이라 중간 레인의 노드·선과 겹쳐 보일 수 있음 | 행 단위로 레인을 따라 그리지 않고 시작·끝점만 잇는 베지어 | `public/app.js:93-98` |
| 10 | 설치 | `package.json`에 `bin`이 있지만 `server.js`에 shebang(`#!/usr/bin/env node`)이 없어 `npx`/전역 설치 실행이 실패함 | shebang 누락 | `server.js:1`, `package.json` |
| 11 | 문서 | README의 `REPO=… PORT=5000 node server.js` 예시 바로 다음 줄 URL이 4317 포트 | README 예시 불일치 | `README.md` |
| 12 | 문서 | README API 표에 `/api/health`가 없음 | 누락 | `README.md` |
| 13 | 코드 | `log`에 `--topo-order`와 `--date-order`를 같이 넘기지만 실제로는 `--date-order`만 적용됨 | 마지막 옵션 우선 | `server.js:67` |
| 14 | 디자인 | 행 높이·레인 폭 값이 CSS 변수와 JS 상수에 중복 정의 | 단일 출처 없음 | `public/style.css:11-14`, `public/app.js:3` |

## 향후 과제 (제안)

우선순위는 제안이며 확정되지 않았다. 확정된 다음 방향(Electron 데스크톱 앱)은 [06-roadmap/electron-desktop-app.md](../06-roadmap/electron-desktop-app.md)에 있다.

### 버그 수정
- 주석 태그 peel: 포맷에 `%(*objectname)`을 추가하고, 값이 있으면 그 해시로 매칭 (#1)
- `load()` 시작 시 상세 패널·선택 상태 초기화, 에러 시 사이드바도 초기화 (#3, #4)
- 상세 요청에 순번을 매겨 마지막 요청만 반영, `error` 응답 처리 (#5, #6)
- 입력 검증 실패는 400으로 응답 (#7)
- detached HEAD 판별: 결과가 `HEAD`면 `(detached)`로 표시 (#8)
- `server.js`에 shebang 추가, README 예시·API 표 정정 (#10~#12)

### 기능
- 커밋 더 불러오기(무한 스크롤 또는 "더 보기")와 400개 밖 ref로 이동 시 안내 또는 추가 로딩
- Working dir 변경 파일 목록 표시(`/api/status`의 `files` 활용), 브랜치 ahead/behind 표시
- 커밋 상세에서 파일별 diff 보기
- 커밋 검색·작성자/브랜치 필터
- 입력한 레포 경로를 URL(`?repo=`)에 반영해 새로고침 후에도 유지

### 보안 강화
- `Host` 헤더를 `127.0.0.1`/`localhost`로 제한해 DNS 리바인딩 차단
- 허용할 레포 루트 목록(예: 환경변수) 옵션
- 500 응답에서 실행 명령줄 제거
- `Content-Security-Policy`, `X-Content-Type-Options: nosniff` 헤더 추가

### 품질
- 서버 모듈 테스트는 있음(`test/server.test.js`). `layout()` 단위 테스트(머지·분기·합류 케이스)와 엔드포인트별 응답 테스트는 아직 없음
- 그래프 상수의 단일 출처화(CSS 변수를 JS에서 읽거나 그 반대)
