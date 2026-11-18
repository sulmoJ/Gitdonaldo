# Gitdonaldo Feature Spec

Gitdonaldo의 현재 구현(커밋 `f042d13`, v0.1.0) 기준 기능 명세서다.
00~05는 코드에 실제로 구현된 동작만 적는다. 구현과 문서가 어긋나거나 아직 없는 기능은 [05-quality](./05-quality/)에, 확정된 다음 구현 방향은 [06-roadmap](./06-roadmap/)에 따로 모았다.

## 폴더 구성 기준

**시스템 계층(요청이 흐르는 순서) + 횡단 관심사**로 나눴다. 번호는 읽는 순서이자 의존 방향이다.
앞 번호 문서는 뒤 번호 문서를 몰라도 읽히고, 뒤 번호 문서는 앞 문서를 참조한다.

| 폴더 | 무엇을 다루나 | 기준 |
|---|---|---|
| [00-overview](./00-overview/) | 제품 목적, 범위, 전체 아키텍처, 실행 방법 | 전체 그림. 처음 읽는 사람용 |
| [01-backend](./01-backend/) | Node 서버 런타임, git 실행 엔진 | `server.js` 내부 동작 |
| [02-api](./02-api/) | HTTP API 계약(요청·응답·에러) | 백엔드와 프론트엔드의 경계. 둘 다 이 계약에 맞춘다 |
| [03-frontend](./03-frontend/) | 화면 기능 단위 명세(레이아웃, 그래프, 사이드바, 상세, 레포 선택) | `public/app.js`·`index.html`. 사용자가 보는 기능 하나당 문서 하나 |
| [04-design](./04-design/) | 색상·크기 토큰, 시각 규칙 | `public/style.css`. 여러 화면에 걸친 시각 규칙 |
| [05-quality](./05-quality/) | 보안, 제약, 알려진 이슈, 향후 과제 | 비기능 요구사항. 특정 계층에 속하지 않는 것 |
| [06-roadmap](./06-roadmap/) | 다음에 구현할 기능의 계획 스펙 | 아직 코드에 없는 것. 구현되면 해당 계층 폴더로 내용을 옮긴다 |

## 문서 목록

- 00-overview
  - [product-overview.md](./00-overview/product-overview.md) — 목적, 범위, 비목표
  - [architecture.md](./00-overview/architecture.md) — 구성 요소, 데이터 흐름, 실행·설정
- 01-backend
  - [server-runtime.md](./01-backend/server-runtime.md) — HTTP 서버, 라우팅, 정적 파일, 에러 처리
  - [git-engine.md](./01-backend/git-engine.md) — git 호출 방식, 명령별 파싱 규칙
- 02-api
  - [api-conventions.md](./02-api/api-conventions.md) — 공통 규약(파라미터, 응답, 에러 코드)
  - [api-endpoints.md](./02-api/api-endpoints.md) — 엔드포인트별 명세
- 03-frontend
  - [ui-layout.md](./03-frontend/ui-layout.md) — 화면 구성과 초기 로딩
  - [commit-graph.md](./03-frontend/commit-graph.md) — 레인 배치 알고리즘, SVG 렌더링, 커밋 행
  - [refs-sidebar.md](./03-frontend/refs-sidebar.md) — Working dir 상태, 브랜치·태그 목록
  - [commit-detail.md](./03-frontend/commit-detail.md) — 커밋 상세 패널
  - [repo-selection.md](./03-frontend/repo-selection.md) — 대상 레포 지정과 새로고침
- 04-design
  - [design-tokens.md](./04-design/design-tokens.md) — 색상, 치수, 타이포그래피
- 05-quality
  - [security.md](./05-quality/security.md) — 보안 모델과 방어 장치
  - [constraints-and-known-issues.md](./05-quality/constraints-and-known-issues.md) — 제약, 알려진 이슈, 향후 과제
- 06-roadmap
  - [electron-desktop-app.md](./06-roadmap/electron-desktop-app.md) — [계획] Electron 단일 데스크톱 앱 패키징

## 작성 규칙

- 근거 코드 위치를 `파일:줄` 형식으로 적는다. 코드가 바뀌면 같은 PR에서 문서도 고친다.
- "구현됨"과 "계획/제안"을 섞지 않는다. 확정된 다음 구현 방향은 06-roadmap에, 아이디어 수준의 제안은 05-quality의 향후 과제에 적는다.
- 06-roadmap 문서는 맨 위에 상태(계획/진행 중/완료)를 적는다.
- 새 화면 기능은 03-frontend에 문서를 하나 추가하고, 새 엔드포인트는 02-api/api-endpoints.md에 절을 추가한다.
