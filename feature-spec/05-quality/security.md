# 보안

## 위협 모델

Gitdonaldo는 **개발자 본인의 로컬 머신에서 본인이 쓰는 도구**로 설계됐다. 서버를 실행한 OS 사용자의 권한으로 git을 실행하므로, API에 접근할 수 있는 사람은 그 사용자가 읽을 수 있는 모든 git 저장소의 히스토리를 읽을 수 있다.

## 현재 방어 장치

| 위협 | 대책 | 근거 |
|---|---|---|
| 외부 네트워크 접근 | `127.0.0.1`에만 바인딩 | `server.js:176` |
| 저장소 변경 | 읽기 전용 git 명령만 호출(`rev-parse`, `for-each-ref`, `log`, `status`, `show`) | `server.js` 전체 |
| 셸 명령 주입 | `execFile`에 인자 배열 전달, 셸 미경유 | `server.js:18` |
| git 옵션 주입(해시 자리) | 해시를 `/^[0-9a-fA-F]{4,40}$/`로 검증. `-`로 시작하는 값이 들어갈 수 없다 | `server.js:103` |
| `limit` 남용 | 최대 2000으로 제한 | `server.js:151` |
| 정적 파일 경로 탈출 | 정규화한 경로가 `public/` 밖이면 403 | `server.js:126-127` |
| 큰 출력으로 인한 메모리 고갈 | `maxBuffer` 64 MiB | `server.js:16` |
| 화면 XSS | 사용자 통제 문자열은 `escapeHtml` 또는 `textContent`로 삽입 | `public/app.js:189-192`, `renderList`, `renderRefs` |

## 남은 위험

| 위험 | 설명 | 심각도(로컬 사용 기준) |
|---|---|---|
| 임의 경로 조회 | `?repo=`에 아무 경로나 줄 수 있다. 같은 머신의 다른 저장소도 읽힌다. 허용 목록이 없다. | 중 |
| DNS 리바인딩·CSRF | Host 헤더와 Origin을 검사하지 않는다. 악성 웹페이지가 DNS 리바인딩으로 `127.0.0.1:4317`에 요청해 응답을 읽을 가능성이 있다. | 중 |
| `repo` 값의 옵션 해석 | `-C` 바로 뒤 인자로 들어가므로 git 옵션으로 해석되지는 않지만, 값 검증은 없다. | 낮음 |
| 에러에 내부 정보 노출 | 500 응답에 git stderr와 실행한 명령줄이 포함된다. | 낮음 |
| 저장소 설정 실행 | 신뢰할 수 없는 저장소를 열면 그 저장소의 `.git/config`(예: `core.fsmonitor`)가 `git status` 중에 실행될 수 있다. git 자체의 특성이며 최신 git은 소유권 검사(`safe.directory`)로 일부 막는다. | 중 |
| 보안 헤더 없음 | CSP, `X-Content-Type-Options` 등을 보내지 않는다. | 낮음 |

대응안은 [constraints-and-known-issues.md](./constraints-and-known-issues.md)의 향후 과제에 있다.
