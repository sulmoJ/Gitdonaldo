# 제약, 알려진 이슈, 향후 과제

v0.1.0 코드 검토와 실제 API 호출·E2E 실행으로 확인한 내용이다. 데스크톱 앱(Electron) 반영 기준.

## 설계상 제약

| 항목 | 내용 |
|---|---|
| 커밋 수 | 화면은 최근 400개만 로드한다(API 최대 2000). 더 보기·페이지네이션 없음 |
| 갱신 | 쓰기 후에는 자동으로 전체 재조회. 외부 변경은 수동 새로고침. 파일 감시·폴링 없음 |
| 쓰기 범위 | 파일 단위 스테이징만(hunk 단위 없음). 대화형 rebase, 브랜치 이름 변경, 원격 브랜치 삭제, 태그 push 없음 ([write-operations D](../06-roadmap/write-operations.md#d-아직-안-한-것)) |
| 화면 | 고정 3열 레이아웃, 반응형·라이트 모드 없음 |
| 기능 | 검색·필터, 파일별 diff, blame 없음 |
| 실행 환경 | 시스템 `git` 필요. 데스크톱 앱은 Node 불필요(Electron 내장), 브라우저 모드는 Node 18+ |
| 배포 | macOS만 출시. ad-hoc 서명이며 공증·자동 업데이트 없음 → 받은 dmg는 Gatekeeper가 막아 사용자가 직접 허용해야 한다([packaging](../00-overview/packaging.md#서명-상태)) |

## 알려진 이슈

| # | 영역 | 증상 | 원인 | 근거 |
|---|---|---|---|---|
| 1 | 그래프/사이드바 | ~~주석 태그가 커밋 행에 칩으로 안 붙고, 사이드바에서 클릭해도 이동하지 않음~~ → 수정됨 ([write-operations B10](../06-roadmap/write-operations.md#b10-신규-함께-고친-알려진-이슈)) | — | — |
| 2 | 사이드바 | ~~400개 밖 커밋을 가리키는 ref를 클릭해도 반응 없음~~ → 수정됨 ([write-operations B10](../06-roadmap/write-operations.md#b10-신규-함께-고친-알려진-이슈)) | — | — |
| 3 | 로딩 | ~~잘못된 경로로 바꾸면 사이드바와 상세 패널에 이전 레포 내용이 남음~~ → 수정됨 ([write-operations B10](../06-roadmap/write-operations.md#b10-신규-함께-고친-알려진-이슈)) | — | — |
| 4 | 상세 | ~~레포를 바꾸거나 새로고침해도 이전에 선택한 커밋 상세가 남음~~ → 수정됨 ([write-operations B10](../06-roadmap/write-operations.md#b10-신규-함께-고친-알려진-이슈)) | — | — |
| 5 | 상세 | ~~빠르게 연속 클릭하면 늦게 도착한 응답이 화면을 덮어씀~~ → 수정됨 ([write-operations B10](../06-roadmap/write-operations.md#b10-신규-함께-고친-알려진-이슈)) | — | — |
| 6 | 상세 | ~~API 에러 시 `undefined`, `Invalid Date` 표시~~ → 수정됨 ([write-operations B10](../06-roadmap/write-operations.md#b10-신규-함께-고친-알려진-이슈)) | — | — |
| 7 | API | ~~잘못된 해시 형식이 400이 아닌 500~~ → 수정됨 ([write-operations B10](../06-roadmap/write-operations.md#b10-신규-함께-고친-알려진-이슈)) | — | — |
| 8 | 레포 정보 | ~~detached HEAD일 때 브랜치명이 `HEAD`로 표시됨(`(detached)` 아님)~~ → 수정됨 ([write-operations B10](../06-roadmap/write-operations.md#b10-신규-함께-고친-알려진-이슈)) | — | — |
| 9 | 그래프 | 여러 행을 건너는 간선이 하나의 긴 곡선이라 중간 레인의 노드·선과 겹쳐 보일 수 있음 | 행 단위로 레인을 따라 그리지 않고 시작·끝점만 잇는 베지어 | `public/app.js:99-104` |
| 10 | 설치 | ~~`package.json`에 `bin`이 있지만 `server.js`에 shebang(`#!/usr/bin/env node`)이 없어 `npx`/전역 설치 실행이 실패함~~ → 수정됨 ([write-operations B10](../06-roadmap/write-operations.md#b10-신규-함께-고친-알려진-이슈)) | — | — |
| 11 | 문서 | ~~README의 `PORT=5000` 예시 URL이 4317 포트~~ → 수정됨 | — | `README.md` |
| 12 | 문서 | ~~README API 표에 `/api/health` 누락~~ → 수정됨 | — | `README.md` |
| 13 | 코드 | ~~`log`에 `--topo-order`와 `--date-order`를 같이 넘기지만 실제로는 `--date-order`만 적용됨~~ → 수정됨 ([write-operations B10](../06-roadmap/write-operations.md#b10-신규-함께-고친-알려진-이슈)) | — | — |
| 14 | 디자인 | 행 높이·레인 폭 값이 CSS 변수와 JS 상수에 중복 정의 | 단일 출처 없음 | `public/style.css:11-14`, `public/app.js:3` |
| 15 | 패키징 | 패키지된 Intel(x64) 앱은 CI에서 빌드·번들 검사만 하고 실행 E2E는 하지 않음 | CI 러너가 Apple Silicon | `.github/workflows/ci.yml` |
| 16 | 의존성 | `npm audit`에서 개발용 패키지(`electron-builder` 하위 `minimatch`, `picomatch`)에 취약점 경고 | 빌드 도구 전이 의존성. 앱 런타임(asar)에는 들어가지 않음(`npm audit --omit=dev` 0건) | `package-lock.json` |
| 17 | 디자인 | 앱 아이콘이 임시 디자인 | 이름·아이콘 미확정 | `build/icon.svg` |

## 향후 과제 (제안)

우선순위는 제안이며 확정되지 않았다. Electron 데스크톱 앱 로드맵(M1~M4)은 완료됐고, 그 후속 과제는 [06-roadmap/electron-desktop-app.md](../06-roadmap/electron-desktop-app.md#9-단계-계획)에 있다.

### 버그 수정
- 남은 항목: #9(그래프 간선 겹침), #14(상수 중복). 나머지는 쓰기 기능 작업에서 고쳤다.

### 기능
- 커밋 더 불러오기(무한 스크롤 또는 "더 보기")와 400개 밖 ref로 이동 시 안내 또는 추가 로딩
- 커밋 상세에서 파일별 diff 보기
- 커밋 검색·작성자/브랜치 필터
- 입력한 레포 경로를 URL(`?repo=`)에 반영해 새로고침 후에도 유지

### 보안 강화
- ~~`Host` 헤더 제한, CSP·`nosniff` 헤더~~ → 완료(M3)
- 허용할 레포 루트 목록(예: 환경변수) 옵션
- ~~500 응답에서 실행 명령줄 제거~~ → 완료(에러 모델 `code` + 마스킹된 `stderr`만)

### 품질
- 서버 단위 테스트(`test/server.test.js` 11개 + `test/write.test.js` 21개)와 Electron E2E(`e2e/electron.e2e.js`, 18개 항목)는 있음. `layout()` 단위 테스트(머지·분기·합류 케이스)와 엔드포인트별 응답 형식 테스트는 아직 없음
- ~~CI~~ → 완료(`.github/workflows/ci.yml`, macOS)
- Developer ID 서명·공증으로 Gatekeeper 경고 제거
- 그래프 상수의 단일 출처화(CSS 변수를 JS에서 읽거나 그 반대)
