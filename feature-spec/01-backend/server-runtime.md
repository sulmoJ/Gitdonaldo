# 서버 런타임

근거: `server.js` 전체. Node 코어 `http` 모듈로 만든 단일 프로세스 서버다.

## 기동 방식

`server.js`는 두 가지로 쓸 수 있다.

| 방식 | 사용처 | 포트 | 기본 레포 |
|---|---|---|---|
| 단독 실행 `node server.js` | 브라우저 모드 | `PORT` 환경변수, 없으면 4317 | `REPO` 환경변수, 없으면 실행 디렉터리 |
| 모듈 `require('./server.js').start(opts)` | Electron 메인 프로세스, 테스트 | `opts.port`, 기본 0(OS가 빈 포트 배정) | `opts.defaultRepo` |

- 단독 실행 여부는 `require.main === module`로 판별한다 (`server.js:236`). `require`로 불러오기만 하면 서버가 뜨지 않는다.
- 어느 방식이든 `127.0.0.1`에만 바인딩한다 (`server.js:216`).
- `PORT`는 `Number(process.env.PORT) || 4317` (`server.js:10`). 숫자가 아니거나 0이면 4317.
- `DEFAULT_REPO`는 `process.env.REPO || process.cwd()` (`server.js:12`).
- `PUBLIC_DIR`는 `server.js`가 있는 디렉터리의 `public/` (`server.js:11`). 서버를 어느 디렉터리에서 실행해도 정적 파일 위치는 같다.

### `start(opts)` — 모듈 API

`server.js:211-232`

```js
const { start } = require('./server.js');
const app = await start({ port: 0, defaultRepo: null, token: 'random-hex' });
// app.port   실제 배정된 포트
// app.url    'http://127.0.0.1:<port>'
// app.server http.Server 인스턴스
await app.close(); // 열린 연결까지 닫고 resolve
```

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `port` | `0` | 0이면 OS가 빈 포트를 배정한다. 여러 인스턴스를 동시에 띄워도 충돌하지 않는다 |
| `defaultRepo` | `DEFAULT_REPO` | 요청에 `?repo=`가 없을 때 쓸 레포. `null`이면 기본 레포 없음 → `?repo=` 없는 API 요청은 400 `no repo selected` |
| `token` | `null` | 값이 있으면 모든 `/api/*` 요청에 `x-gitdonaldo-token` 헤더로 같은 값을 요구한다. 데스크톱 앱은 실행마다 임의 64자 hex를 넘긴다. 단독 실행(브라우저 모드)은 토큰 없음 |

- 반환: listen이 끝나면 resolve하는 Promise.
- 포트가 이미 쓰이고 있으면 `code: 'EADDRINUSE'` 에러로 reject한다.
- `close()`는 `server.close()`와 함께 `closeAllConnections()`(Node 18.2+)를 불러 keep-alive 연결 때문에 종료가 늦어지지 않게 한다.
- 같은 모듈에서 `createHandler`, `TOKEN_HEADER`, `isRepo`, `apiRepo`, `apiRefs`, `apiCommits`, `apiStatus`, `apiCommit`도 내보낸다. 나중에 IPC로 옮길 때(로드맵 안 B) 핸들러를 그대로 재사용하기 위해서다.

### 단독 실행 시 로그

```
[Gitdonaldo] git engine ready -> http://127.0.0.1:4317
[Gitdonaldo] default repo: /path/to/cwd
```

포트가 이미 쓰이고 있으면 `[Gitdonaldo] failed to start: port 4317 is already in use`를 출력하고 종료 코드 1로 끝난다.

## 요청 보안 검사

모든 요청은 라우팅 전에 다음 순서로 검사한다 (`server.js:161-177`). 근거와 위협은 [security](../05-quality/security.md).

1. **보안 헤더** — 모든 응답에 붙인다.

   | 헤더 | 값 |
   |---|---|
   | `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` |
   | `X-Content-Type-Options` | `nosniff` |
   | `Referrer-Policy` | `no-referrer` |
   | `Cross-Origin-Resource-Policy` | `same-origin` |

2. **Host 검사** — `Host` 헤더가 `127.0.0.1:<포트>` 또는 `localhost:<포트>`가 아니면 `403 forbidden host`(text). 정적 파일과 API 모두 적용. DNS 리바인딩 차단용이다. 허용 목록은 listen 직후 실제 포트로 채운다.
3. **토큰 검사** — `start({ token })`으로 띄운 경우 `/api/*`에만 적용. `x-gitdonaldo-token` 헤더가 다르거나 없으면 `403 {"error":"forbidden"}`. `/api/health`도 예외가 아니다. 비교는 `crypto.timingSafeEqual`. 정적 파일(`index.html` 등)은 토큰 없이 받을 수 있다(비밀이 없는 공개 코드).

## 요청 라우팅

`createHandler({ defaultRepo })`가 만든 핸들러 하나가 모든 요청을 받는다 (`server.js:161-200`).

```
(공통) 보안 헤더 설정 → Host 검사 실패 ──▶ 403 forbidden host
pathname이 /api/ 로 시작하지 않음 ──▶ serveStatic()
pathname이 /api/ 로 시작함
  ├─ 토큰 필요한데 불일치         ──▶ 403 {error:'forbidden'}
  ├─ repo = ?repo 값 || defaultRepo
  ├─ /api/health                ──▶ 200 {ok:true}        (레포 검사 전에 응답)
  ├─ repo가 비어 있음            ──▶ 400 {error:'no repo selected'}
  ├─ isRepo(repo) 실패           ──▶ 400 {error}
  ├─ /api/repo | refs | status | commits | commit ──▶ 각 핸들러
  └─ 그 외                       ──▶ 404 {error:'unknown endpoint'}
핸들러에서 예외 발생              ──▶ 500 {error, stderr}
```

- HTTP 메서드는 구분하지 않는다. GET 외 메서드도 같은 경로면 같은 응답을 준다.
- 경로 매칭은 완전 일치(`===`)다. 뒤에 `/`가 붙으면 404.
- `/api/health`를 뺀 모든 API는 요청마다 `isRepo` 검사를 먼저 한다 (`git rev-parse --is-inside-work-tree`).

## 정적 파일 서빙

`serveStatic(req, res, pathname)` (`server.js:144-153`)

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

캐시 헤더(`Cache-Control`, `ETag`)는 보내지 않는다. 보안 헤더는 위 "요청 보안 검사"대로 붙는다.

## JSON 응답

`sendJSON(res, code, obj)` (`server.js:139-142`) — `content-type: application/json; charset=utf-8`로 `JSON.stringify(obj)`를 보낸다. 모든 API 응답이 이 함수를 거친다.

## 에러 처리

| 상황 | 상태 코드 | 본문 |
|---|---|---|
| `Host` 헤더가 허용 목록 밖 | 403 | `forbidden host` (text) |
| 토큰 필요한데 헤더 없음·불일치 | 403 | `{ "error": "forbidden" }` |
| `?repo=`도 기본 레포도 없음(`defaultRepo: null`) | 400 | `{ "error": "no repo selected" }` |
| 대상 경로가 git 작업 트리가 아님(없는 경로 포함) | 400 | `{ "error": "not a git repo: <경로>" }` |
| 알 수 없는 `/api/*` 경로 | 404 | `{ "error": "unknown endpoint" }` |
| 핸들러 예외(git 실패, 잘못된 해시 등) | 500 | `{ "error": <메시지>, "stderr": <git stderr 또는 생략> }` |
| 정적 파일 경로 탈출 | 403 | `forbidden` (text) |
| 정적 파일 없음 | 404 | `not found` (text) |

`stderr`가 `undefined`이면 `JSON.stringify`가 키를 빼므로 응답에 나타나지 않는다.
