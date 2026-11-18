# API 공통 규약

백엔드(`server.js`)와 프론트엔드(`public/app.js`)가 공유하는 계약이다. 엔드포인트별 명세는 [api-endpoints.md](./api-endpoints.md).

## 기본

- 기본 URL: `http://127.0.0.1:<PORT>` (기본 포트 4317)
- 모든 API는 `/api/` 아래에 있다.
- 메서드: `GET` (서버는 메서드를 검사하지 않지만 클라이언트는 GET만 쓴다)
- 응답: `application/json; charset=utf-8`
- 인증 없음. 서버가 루프백에만 바인딩한다는 점이 접근 통제의 전부다.
- **읽기 전용**: 어떤 API도 저장소 상태를 바꾸지 않는다.

## 공통 쿼리 파라미터

| 이름 | 필수 | 설명 |
|---|---|---|
| `repo` | 아니오 | 대상 저장소 경로(절대 경로 권장, 상대 경로는 서버 작업 디렉터리 기준). 없으면 서버의 `REPO` 환경변수 또는 실행 디렉터리. 저장소 안의 하위 디렉터리를 줘도 된다. |

`/api/health`를 뺀 모든 엔드포인트는 처리 전에 `repo`가 git 작업 트리인지 확인한다.

## 에러 응답

본문은 항상 `error` 문자열을 가진 객체다.

```json
{ "error": "not a git repo: /tmp" }
```

| 코드 | 의미 | 예 |
|---|---|---|
| 400 | 대상 경로가 git 작업 트리가 아님 | 없는 경로, bare 저장소, 일반 디렉터리 |
| 404 | 알 수 없는 API 경로 | `/api/nope` |
| 500 | 처리 중 예외 | 잘못된 해시 형식, 없는 커밋, git 실행 실패 |

500 응답에는 git의 stderr가 `stderr` 필드로 붙을 수 있다.

```json
{ "error": "Command failed: git -C . show -s ...", "stderr": "fatal: bad object deadbeef\n" }
```

> 입력값 검증 실패(`bad hash`)도 현재는 500이다. 400으로 바꾸는 안은 [향후 과제](../05-quality/constraints-and-known-issues.md)에 있다.

## 데이터 형식

- 해시: 40자 소문자 16진수 문자열(SHA-1 저장소 기준).
- 날짜: git의 엄격한 ISO 8601(`%aI`/`%cI`), 작성자 시간대 오프셋 포함. 예: `2026-11-18T10:23:56+09:00`
- 문자열 필드는 git 출력을 그대로 담는다. HTML 이스케이프는 클라이언트 책임이다.

## 클라이언트 호출 규칙

`api(ep, params)` (`public/app.js:16-22`)

- `repo` 결정 순서: 입력창에서 Enter로 지정한 값(`state.repoPath`) → 페이지 URL의 `?repo=` → 생략(서버 기본값).
- 응답 상태 코드는 보지 않고 항상 `r.json()`을 반환한다. 에러 판단은 본문의 `error` 필드로 한다.
