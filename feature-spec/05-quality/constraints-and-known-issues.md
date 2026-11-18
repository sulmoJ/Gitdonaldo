# 제약, 알려진 이슈, 향후 과제

v0.1.0 코드 검토와 실제 API 호출·E2E 실행으로 확인한 내용이다. 데스크톱 앱(Electron) 반영 기준.

## 설계상 제약

| 항목 | 내용 |
|---|---|
| 커밋 수 | 화면은 최근 400개만 로드한다(API 최대 2000). 더 보기·페이지네이션 없음 |
| 갱신 | 수동 새로고침만 지원. 파일 감시·폴링 없음 |
| 읽기 전용 | checkout, fetch 등 쓰기 작업 없음 |
| 화면 | 고정 3열 레이아웃, 반응형·라이트 모드 없음 |
| 기능 | 검색·필터, 파일별 diff, blame, stash 목록 없음 |
| 실행 환경 | 시스템 `git` 필요. 데스크톱 앱은 Node 불필요(Electron 내장), 브라우저 모드는 Node 18+ |
| 배포 | 코드 서명·공증·자동 업데이트 없음. 서명 전에는 OS 보안 경고가 뜬다 |

## 알려진 이슈

| # | 영역 | 증상 | 원인 | 근거 |
|---|---|---|---|---|
| 1 | 그래프/사이드바 | 주석 태그가 커밋 행에 칩으로 안 붙고, 사이드바에서 클릭해도 이동하지 않음 | `for-each-ref`의 `%(objectname)`이 태그 객체 해시. `%(*objectname)`(peel)을 쓰지 않음 | `server.js:48-51` |
| 2 | 사이드바 | 400개 밖 커밋을 가리키는 ref를 클릭해도 반응 없음 | 로드된 행에서만 찾음. 안내 없음 | `public/app.js:223-226` |
| 3 | 로딩 | 잘못된 경로로 바꾸면 사이드바와 상세 패널에 이전 레포 내용이 남음 | 에러 처리에서 목록·그래프만 비움 | `public/app.js:261-267` |
| 4 | 상세 | 레포를 바꾸거나 새로고침해도 이전에 선택한 커밋 상세가 남음 | `load()`가 상세 패널을 초기화하지 않음 | `public/app.js:235` |
| 5 | 상세 | 빠르게 연속 클릭하면 늦게 도착한 응답이 화면을 덮어씀 | 요청 순서 확인 없음 | `public/app.js:175-193` |
| 6 | 상세 | API 에러 시 `undefined`, `Invalid Date` 표시 | `d.error` 처리 없음 | `public/app.js:179` |
| 7 | API | 잘못된 해시 형식이 400이 아닌 500 | 검증 실패도 일반 예외로 처리 | `server.js:104` |
| 8 | 레포 정보 | detached HEAD일 때 브랜치명이 `HEAD`로 표시됨(`(detached)` 아님) | `rev-parse --abbrev-ref HEAD`가 성공하며 `HEAD`를 출력 | `server.js:41` |
| 9 | 그래프 | 여러 행을 건너는 간선이 하나의 긴 곡선이라 중간 레인의 노드·선과 겹쳐 보일 수 있음 | 행 단위로 레인을 따라 그리지 않고 시작·끝점만 잇는 베지어 | `public/app.js:99-104` |
| 10 | 설치 | `package.json`에 `bin`이 있지만 `server.js`에 shebang(`#!/usr/bin/env node`)이 없어 `npx`/전역 설치 실행이 실패함 | shebang 누락 | `server.js:1`, `package.json` |
| 11 | 문서 | ~~README의 `PORT=5000` 예시 URL이 4317 포트~~ → 수정됨 | — | `README.md` |
| 12 | 문서 | ~~README API 표에 `/api/health` 누락~~ → 수정됨 | — | `README.md` |
| 13 | 코드 | `log`에 `--topo-order`와 `--date-order`를 같이 넘기지만 실제로는 `--date-order`만 적용됨 | 마지막 옵션 우선 | `server.js:68` |
| 14 | 디자인 | 행 높이·레인 폭 값이 CSS 변수와 JS 상수에 중복 정의 | 단일 출처 없음 | `public/style.css:11-14`, `public/app.js:3` |
| 15 | 패키징 | macOS `.dmg`, Windows `.exe` 설치 파일은 빌드·실행을 검증하지 못함 | 해당 OS 빌드 환경 없음. Linux AppImage만 검증 | `package.json` `build` |
| 16 | 의존성 | `npm audit`에서 개발용 패키지(`electron-builder` 하위 `minimatch`, `picomatch`)에 취약점 경고 | 빌드 도구 전이 의존성. 앱 런타임(asar)에는 들어가지 않음(`npm audit --omit=dev` 0건) | `package-lock.json` |
| 17 | 디자인 | 앱 아이콘이 임시 디자인 | 이름·아이콘 미확정 | `build/icon.svg` |

## 향후 과제 (제안)

우선순위는 제안이며 확정되지 않았다. Electron 데스크톱 앱 로드맵(M1~M4)은 완료됐고, 그 후속 과제는 [06-roadmap/electron-desktop-app.md](../06-roadmap/electron-desktop-app.md#9-단계-계획)에 있다.

### 버그 수정
- 주석 태그 peel: 포맷에 `%(*objectname)`을 추가하고, 값이 있으면 그 해시로 매칭 (#1)
- `load()` 시작 시 상세 패널·선택 상태 초기화, 에러 시 사이드바도 초기화 (#3, #4)
- 상세 요청에 순번을 매겨 마지막 요청만 반영, `error` 응답 처리 (#5, #6)
- 입력 검증 실패는 400으로 응답 (#7)
- detached HEAD 판별: 결과가 `HEAD`면 `(detached)`로 표시 (#8)
- `server.js`에 shebang 추가 (#10)

### 기능
- 커밋 더 불러오기(무한 스크롤 또는 "더 보기")와 400개 밖 ref로 이동 시 안내 또는 추가 로딩
- Working dir 변경 파일 목록 표시(`/api/status`의 `files` 활용), 브랜치 ahead/behind 표시
- 커밋 상세에서 파일별 diff 보기
- 커밋 검색·작성자/브랜치 필터
- 입력한 레포 경로를 URL(`?repo=`)에 반영해 새로고침 후에도 유지

### 보안 강화
- ~~`Host` 헤더 제한, CSP·`nosniff` 헤더~~ → 완료(M3)
- 허용할 레포 루트 목록(예: 환경변수) 옵션
- 500 응답에서 실행 명령줄 제거

### 품질
- 서버 단위 테스트(`test/server.test.js`, 11개)와 Electron E2E(`e2e/electron.e2e.js`, 16개 항목)는 있음. `layout()` 단위 테스트(머지·분기·합류 케이스)와 엔드포인트별 응답 형식 테스트는 아직 없음
- OS별 빌드·E2E를 돌리는 CI(GitHub Actions 매트릭스)
- 그래프 상수의 단일 출처화(CSS 변수를 JS에서 읽거나 그 반대)
