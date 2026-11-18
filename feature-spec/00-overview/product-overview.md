# 제품 개요

## 한 줄 정의

의존성 없이 Node 코어 모듈과 시스템 `git`만으로 동작하는, **읽기 전용** git 저장소 뷰어 웹앱.

## 목적

- 로컬 git 저장소의 커밋 히스토리를 브라우저에서 그래프로 본다.
- 브랜치·원격 브랜치·태그가 어느 커밋을 가리키는지 한눈에 본다.
- 커밋 하나를 골라 메타데이터, 본문, 변경 파일 통계를 본다.
- 설치 부담을 없앤다. `npm install` 없이 `node server.js` 한 줄로 실행한다.

## 대상 사용자

로컬 머신에서 git 저장소 히스토리를 가볍게 훑어보려는 개발자. GUI 클라이언트를 설치하기 부담스럽거나, CLI `git log --graph`보다 보기 편한 화면이 필요한 경우.

## 기능 범위 (구현됨)

| 영역 | 기능 | 명세 |
|---|---|---|
| 레포 정보 | 레포 이름, 현재 브랜치, 로드한 커밋 수 표시 | [ui-layout](../03-frontend/ui-layout.md) |
| 커밋 그래프 | 전체 ref(`--all`)의 커밋을 레인 그래프로 표시, 최대 400개 | [commit-graph](../03-frontend/commit-graph.md) |
| ref 칩 | 커밋 행에 브랜치·원격·태그·HEAD 칩 표시 | [commit-graph](../03-frontend/commit-graph.md) |
| 사이드바 | Working dir clean/dirty 상태, Local·Remote·Tags 목록과 개수 | [refs-sidebar](../03-frontend/refs-sidebar.md) |
| ref 이동 | 사이드바 ref 클릭 시 해당 커밋으로 스크롤 후 선택 | [refs-sidebar](../03-frontend/refs-sidebar.md) |
| 커밋 상세 | 해시, 부모, 작성자, 날짜, 본문, 파일 stat | [commit-detail](../03-frontend/commit-detail.md) |
| 레포 전환 | 입력창에 경로 입력, URL `?repo=`, 환경변수 `REPO` | [repo-selection](../03-frontend/repo-selection.md) |
| HTTP API | 레포/ref/커밋/상태/상세 조회 JSON API | [api-endpoints](../02-api/api-endpoints.md) |

## 비목표 (의도적으로 하지 않는 것)

- **쓰기 작업 없음.** commit, checkout, merge, push, fetch 등 저장소를 바꾸는 명령은 호출하지 않는다.
- 외부 npm 패키지, 빌드 도구, 프레임워크를 쓰지 않는다.
- 원격 접속용 서버가 아니다. `127.0.0.1`에만 바인딩한다.
- 인증·다중 사용자 기능 없음.

## 기술 제약

- Node.js 18 이상 (`package.json` `engines`)
- 시스템 PATH에 `git` 실행 파일
- 브라우저: `fetch`, `URL`, ES2020(옵셔널 체이닝)을 지원하는 최신 브라우저
- 라이선스: MIT
