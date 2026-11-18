# 서버 런타임

근거: `server.js` 전체. Node 코어 `http` 모듈로 만든 단일 프로세스 서버다.

## 기동

- `server.listen(PORT, '127.0.0.1')` — 루프백 주소에만 바인딩한다 (`server.js:161`).
- `PORT`는 `Number(process.env.PORT) || 4317` (`server.js:9`). 숫자가 아니거나 0이면 4317.
- `DEFAULT_REPO`는 `process.env.REPO || process.cwd()` (`server.js:11`).
- `PUBLIC_DIR`는 `server.js`가 있는 디렉터리의 `public/` (`server.js:10`). 서버를 어느 디렉터리에서 실행해도 정적 파일 위치는 같다.

## 요청 라우팅

`http.createServer` 핸들러 하나가 모든 요청을 받는다 (`server.js:135-159`).

```
pathname이 /api/ 로 시작하지 않음 ──▶ serveStatic()
pathname이 /api/ 로 시작함
  ├─ repo = ?repo 값 || DEFAULT_REPO
  ├─ /api/health                ──▶ 200 {ok:true}        (레포 검사 전에 응답)
  ├─ isRepo(repo) 실패           ──▶ 400 {error}
  ├─ /api/repo | refs | status | commits | commit ──▶ 각 핸들러
  └─ 그 외                       ──▶ 404 {error:'unknown endpoint'}
핸들러에서 예외 발생              ──▶ 500 {error, stderr}
```

- HTTP 메서드는 구분하지 않는다. GET 외 메서드도 같은 경로면 같은 응답을 준다.
- 경로 매칭은 완전 일치(`===`)다. 뒤에 `/`가 붙으면 404.
- `/api/health`를 뺀 모든 API는 요청마다 `isRepo` 검사를 먼저 한다 (`git rev-parse --is-inside-work-tree`).

## 정적 파일 서빙

`serveStatic(req, res, pathname)` (`server.js:124-133`)

1. `/`는 `/index.html`로 바꾼다.
2. `path.normalize(path.join(PUBLIC_DIR, rel))`로 실제 경로를 만든다.
3. 결과가 `PUBLIC_DIR`로 시작하지 않으면 `403 forbidden` (경로 탈출 방지).
4. `fs.readFile` 실패 시 `404 not found`.
5. 확장자로 Content-Type을 정한다.

| 확장자 | Content-Type |
|---|---|
| `.html` | `text/html; charset=utf-8` |
| `.js` | `text/javascript; charset=utf-8` |
| `.css` | `text/css; charset=utf-8` |
| `.svg` | `image/svg+xml` |
| `.json` | `application/json` |
| 그 외 | `application/octet-stream` |

캐시 헤더(`Cache-Control`, `ETag`)는 보내지 않는다.

## JSON 응답

`sendJSON(res, code, obj)` (`server.js:119-122`) — `content-type: application/json; charset=utf-8`로 `JSON.stringify(obj)`를 보낸다. 모든 API 응답이 이 함수를 거친다.

## 에러 처리

| 상황 | 상태 코드 | 본문 |
|---|---|---|
| 대상 경로가 git 작업 트리가 아님(없는 경로 포함) | 400 | `{ "error": "not a git repo: <경로>" }` |
| 알 수 없는 `/api/*` 경로 | 404 | `{ "error": "unknown endpoint" }` |
| 핸들러 예외(git 실패, 잘못된 해시 등) | 500 | `{ "error": <메시지>, "stderr": <git stderr 또는 생략> }` |
| 정적 파일 경로 탈출 | 403 | `forbidden` (text) |
| 정적 파일 없음 | 404 | `not found` (text) |

`stderr`가 `undefined`이면 `JSON.stringify`가 키를 빼므로 응답에 나타나지 않는다.
