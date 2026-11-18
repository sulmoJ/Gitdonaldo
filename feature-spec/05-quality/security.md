# 보안

## 위협 모델

Gitdonaldo는 **개발자 본인의 노트북에서 본인이 쓰는 도구**로 설계됐다. 앱(또는 서버)을 실행한 OS 사용자의 권한으로 git을 실행하므로, API에 접근할 수 있는 쪽은 그 사용자가 읽을 수 있는 모든 git 저장소의 히스토리를 읽을 수 있다.

데스크톱 앱은 내부에 루프백 HTTP 서버를 연다. 따라서 **같은 노트북의 다른 프로그램과, 사용자가 브라우저로 연 악성 웹페이지**가 그 포트에 접근하는 것을 주요 위협으로 본다.

## 현재 방어 장치

| 위협 | 대책 | 근거 |
|---|---|---|
| 외부 네트워크 접근 | `127.0.0.1`에만 바인딩 | `server.js:216` |
| 저장소 변경 | 읽기 전용 git 명령만 호출(`rev-parse`, `for-each-ref`, `log`, `status`, `show`) | `server.js` 전체 |
| 셸 명령 주입 | `execFile`에 인자 배열 전달, 셸 미경유 | `server.js:19` |
| git 옵션 주입(해시 자리) | 해시를 `/^[0-9a-fA-F]{4,40}$/`로 검증. `-`로 시작하는 값이 들어갈 수 없다 | `server.js:104` |
| `limit` 남용 | 최대 2000으로 제한 | `server.js:189` |
| 정적 파일 경로 탈출 | 정규화한 경로가 `public/` 밖이면 403 | `server.js:146-147` |
| 큰 출력으로 인한 메모리 고갈 | `maxBuffer` 64 MiB | `server.js:17` |
| 화면 XSS | 사용자 통제 문자열은 `escapeHtml` 또는 `textContent`로 삽입 | `public/app.js:195-198`, `renderList`, `renderRefs` |
| XSS 피해 확대 | CSP `default-src 'self'`(인라인 스크립트·스타일 속성 금지), `nosniff` 등 보안 헤더 | `server.js:121-129` |
| DNS 리바인딩 | `Host` 헤더가 `127.0.0.1:<포트>`/`localhost:<포트>`가 아니면 403 | `server.js:165-169` |
| 다른 로컬 프로그램·웹페이지의 API 호출 **(데스크톱)** | 실행마다 바뀌는 64자 토큰을 `x-gitdonaldo-token` 헤더로 요구. 커스텀 헤더라 다른 출처 페이지는 CORS 사전 요청 없이 보낼 수 없고, 토큰도 모른다. 상수 시간 비교 | `server.js:175-177`, `electron/main.js` |
| 포트 추측 **(데스크톱)** | 고정 포트 대신 OS가 배정한 임의 포트 | `electron/main.js` |
| 렌더러의 Node 접근 **(데스크톱)** | `contextIsolation`, `sandbox` 켬, `nodeIntegration` 끔. preload는 함수 4개만 노출 | `electron/main.js:76-96`, `electron/preload.js` |
| 외부 페이지로 이동·새 창 **(데스크톱)** | 앱 주소 밖 이동 취소, 새 창·`<webview>` 차단, 모든 권한 요청 거부 | `electron/main.js:132-143` |
| 위조 IPC **(데스크톱)** | 메인이 IPC 보낸 프레임의 URL이 앱 주소인지 확인 | `electron/main.js:145-163` |

## 남은 위험

| 위험 | 설명 | 심각도(로컬 사용 기준) |
|---|---|---|
| 임의 경로 조회 | `?repo=`에 아무 경로나 줄 수 있다. 같은 머신의 다른 저장소도 읽힌다. 허용 목록이 없다. 데스크톱 앱은 토큰이 있어야 하므로 앱 UI만 가능하다. | 브라우저 모드 중 / 데스크톱 낮음 |
| 브라우저 모드의 로컬 접근 | `node server.js`에는 토큰이 없다. 같은 노트북의 다른 프로그램은 API를 호출할 수 있다(웹페이지는 Host 검사·CORS로 응답을 못 읽음). 브라우저 모드는 개발용으로 둔다. | 중 |
| `repo` 값의 옵션 해석 | `-C` 바로 뒤 인자로 들어가므로 git 옵션으로 해석되지는 않지만, 값 검증은 없다. | 낮음 |
| 에러에 내부 정보 노출 | 500 응답에 git stderr와 실행한 명령줄이 포함된다. | 낮음 |
| 저장소 설정 실행 | 신뢰할 수 없는 저장소를 열면 그 저장소의 `.git/config`(예: `core.fsmonitor`)가 `git status` 중에 실행될 수 있다. git 자체의 특성이며 최신 git은 소유권 검사(`safe.directory`)로 일부 막는다. | 중 |

대응안은 [constraints-and-known-issues.md](./constraints-and-known-issues.md)의 향후 과제에 있다.
