# API 공통 규약

백엔드(`server.js`)와 프론트엔드(`public/app.js`)가 공유하는 계약이다. 엔드포인트별 명세는 [api-endpoints.md](./api-endpoints.md).

## 기본

- 기본 URL: `http://127.0.0.1:<PORT>` (기본 포트 4317)
- 모든 API는 `/api/` 아래에 있다.
- 메서드: 읽기는 `GET`, 쓰기는 `POST` + `content-type: application/json` ([api-write](./api-write.md)). 읽기 경로에 GET/HEAD 외 메서드는 405.
- 응답: `application/json; charset=utf-8`
- 접근 통제
  - 서버는 루프백(`127.0.0.1`)에만 바인딩한다.
  - `Host` 헤더는 `127.0.0.1:<포트>` 또는 `localhost:<포트>`만 받는다.
  - **데스크톱 앱**: 모든 `/api/*` 요청에 `x-gitdonaldo-token: <실행별 토큰>` 헤더가 필요하다. 토큰은 앱이 창 URL의 `?token=`으로 넘기고, `app.js`가 읽어 헤더로 보낸다.
  - 브라우저 모드(`node server.js`): 토큰 없음.
- 읽기 API는 저장소 상태를 바꾸지 않는다. 쓰기 API는 레포별 락으로 직렬화되고, 파괴적 작업은 2단계 확인을 거친다([api-write](./api-write.md)).

## 공통 쿼리 파라미터

| 이름 | 필수 | 설명 |
|---|---|---|
| `repo` | 아니오 | 대상 저장소 경로(절대 경로 권장, 상대 경로는 서버 작업 디렉터리 기준). 없으면 서버의 `REPO` 환경변수 또는 실행 디렉터리. 저장소 안의 하위 디렉터리를 줘도 된다. |

`/api/health`를 뺀 모든 엔드포인트는 처리 전에 `repo`가 git 작업 트리인지 확인한다.

## 에러 응답

본문은 항상 `error` 문자열을 가진 객체다. 403 토큰 오류를 뺀 모든 에러에는 기계용 `code`도 붙는다(전체 목록은 [api-write](./api-write.md#에러-모델)).

```json
{ "error": "not a git repo: /tmp", "code": "NOT_A_REPO" }
```

| 코드 | 의미 | 예 |
|---|---|---|
| 403 | 토큰 없음·불일치, 또는 허용되지 않은 `Host` | 데스크톱 앱 포트에 `curl`로 직접 요청 |
| 400 | 입력 형식 오류, 대상 경로가 git 작업 트리가 아님, 또는 지정된 레포가 없음 | 잘못된 해시 형식(`bad hash`), 없는 경로, bare 저장소, `defaultRepo: null`인데 `?repo=` 없음 |
| 404 | 알 수 없는 API 경로 | `/api/nope` |
| 500 | 처리 중 예외 | 없는 커밋, git 실행 실패 (`code: GIT_FAILED`) |

git 실패 응답에는 stderr가 `stderr` 필드로 붙을 수 있다(자격정보는 가린다). 실행한 명령줄은 더 이상 내보내지 않는다.

```json
{ "error": "git show failed", "code": "GIT_FAILED", "stderr": "fatal: bad object deadbeef\n" }
```

## 데이터 형식

- 해시: 40자 소문자 16진수 문자열(SHA-1 저장소 기준).
- 날짜: git의 엄격한 ISO 8601(`%aI`/`%cI`), 작성자 시간대 오프셋 포함. 예: `2026-11-18T10:23:56+09:00`
- 문자열 필드는 git 출력을 그대로 담는다. HTML 이스케이프는 클라이언트 책임이다.

## 클라이언트 호출 규칙

`api(ep, params)` (`public/app.js:21-28`)

- `repo` 결정 순서: 입력창에서 Enter로 지정한 값(`state.repoPath`) → 페이지 URL의 `?repo=` → 생략(서버 기본값).
- 페이지 URL에 `?token=`이 있으면 모든 요청에 `x-gitdonaldo-token` 헤더를 붙인다.
- 읽기 `api()`는 응답 상태 코드는 보지 않고 항상 `r.json()`을 반환한다. 에러 판단은 본문의 `error` 필드로 한다.
- 쓰기 `post(ep, body)`는 `{ status, body }`를 반환하고, `runWrite()`가 428 확인 흐름과 토스트를 처리한다([git-actions](../03-frontend/git-actions.md)).
