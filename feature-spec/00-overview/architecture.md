# 아키텍처

## 실행 모드

같은 백엔드(`server.js`)와 UI(`public/`)를 두 가지 방식으로 띄운다.

| 모드 | 실행 | 백엔드 위치 | UI 위치 | 대상 사용자 |
|---|---|---|---|---|
| **데스크톱 앱** | 설치 파일로 설치 후 아이콘 실행 (개발 중에는 `npm run app`) | Electron 메인 프로세스 안 | Electron 창 | 일반 사용자 |
| 브라우저 모드 | `node server.js` | Node 프로세스 | 사용자의 브라우저 | 개발·디버깅 |

두 모드 모두 백엔드와 UI가 **설치한 사람의 노트북 안에서만** 돈다. 외부 서버나 네트워크는 쓰지 않는다.

## 구성 요소 (데스크톱 앱)

```
┌──────────────────────── Gitdonaldo 앱 (Electron) ─────────────────────────┐
│ Main process (Node 내장)                                                   │
│  ├─ electron/main.js   git 확인, 창·메뉴, 설정 저장, IPC                     │
│  └─ server.js start({ port: 0, defaultRepo: null, token })                 │
│        └─ 127.0.0.1:<임의 포트> ── execFile('git', ...) ──▶ 로컬 저장소      │
│                                                                            │
│ Renderer (sandbox) ── http://127.0.0.1:<포트>/?token=…[&repo=…]             │
│  ├─ electron/preload.js  window.gitdonaldo (폴더 선택 등 4개 함수)          │
│  └─ public/ index.html · app.js · style.css (브라우저 모드와 같은 파일)      │
└────────────────────────────────────────────────────────────────────────────┘
```

메인 프로세스 동작은 [desktop-shell](../01-backend/desktop-shell.md), 설치 파일 빌드·CI·출시는 [packaging](./packaging.md)에 있다. 출시 대상은 **macOS**다.

## 구성 요소 (브라우저 모드)

```
┌──────────── Browser ────────────┐        ┌──────────── server.js (Node) ────────────┐
│ index.html  화면 골격            │  HTTP  │ http.createServer                         │
│ style.css   다크 테마            │ ─────▶ │  ├─ /api/*  → API 핸들러 → git() 래퍼      │
│ app.js      상태·렌더링·API 호출 │ ◀───── │  └─ 그 외   → public/ 정적 파일 서빙        │
└─────────────────────────────────┘  JSON  └──────────────────┬────────────────────────┘
                                                              │ execFile('git', ['-C', repo, ...])
                                                              ▼
                                                     시스템 git → 대상 저장소(.git)
```

| 파일 | 역할 | 줄 수 |
|---|---|---|
| `server.js` | HTTP 서버, 라우팅, 보안 검사, git 실행·파싱, 정적 파일 서빙. 단독 실행과 모듈(`start()`) 겸용 | 244 |
| `electron/main.js` | Electron 진입점: git 확인, 백엔드 기동, 창·메뉴, 설정, IPC, 하드닝 | 215 |
| `electron/preload.js` | 렌더러에 `window.gitdonaldo` 브리지 노출 | 13 |
| `public/index.html` | 4영역 레이아웃 골격 | 60 |
| `public/app.js` | 클라이언트 상태, API 호출, 그래프 레이아웃·렌더링, 이벤트, 데스크톱 브리지 연동 | 283 |
| `public/style.css` | 디자인 토큰과 레이아웃 스타일 | 113 |
| `build/icon.svg`, `build/icon.png` | 앱 아이콘 원본(SVG)과 빌드용 1024px PNG | — |
| `test/server.test.js` | 서버 단위 테스트(`node:test`) | — |
| `e2e/electron.e2e.js` | Electron 앱 E2E(`playwright-core`) | — |
| `package.json` | 메타데이터, 스크립트, `electron-builder` 설정(`build`) | — |
| `.github/workflows/ci.yml` | CI: 단위 테스트, macOS 빌드·E2E, 태그 시 릴리스 | — |

UI 코드에는 빌드 단계가 없다. `public/` 파일을 그대로 쓴다. 설치 파일만 `electron-builder`로 만든다.

## 데이터 흐름 (초기 로딩)

1. 브라우저가 `/`를 요청하면 서버가 `public/index.html`을 준다.
2. `app.js`의 `load()`가 API 4개를 **병렬로** 호출한다 (`public/app.js:241-242`).
   - `/api/repo`, `/api/refs`, `/api/commits?limit=400`, `/api/status`
3. 서버는 요청마다 대상 레포가 git 작업 트리인지 확인하고(`isRepo`), git 명령을 실행해 결과를 JSON으로 바꾼다.
4. 클라이언트는 커밋 목록으로 레인 배치를 계산하고(`layout`), SVG 그래프와 커밋 행 목록, 사이드바를 그린다.
5. 커밋 행을 클릭하면 `/api/commit?hash=`를 호출해 상세 패널을 채운다.

## 실행과 설정

```bash
npm run app           # 데스크톱 앱 (개발 실행)
node server.js        # 브라우저 모드 (= npm start)
npm test              # 서버 단위 테스트
npm run test:e2e      # Electron E2E (Linux 헤드리스: xvfb-run -a npm run test:e2e)
npm run dist          # macOS dmg (arm64, x64) → dist/  ※ macOS에서만
```

다른 Node 코드에서 `require('./server.js').start({ port: 0 })`로 띄울 수도 있다. 자세한 내용은 [server-runtime](../01-backend/server-runtime.md#startopts--모듈-api).

브라우저 모드 설정:

| 설정 | 방법 | 기본값 | 근거 |
|---|---|---|---|
| 포트 | 환경변수 `PORT` | `4317` | `server.js:10` |
| 기본 대상 레포 | 환경변수 `REPO` | 서버 실행 디렉터리(`process.cwd()`) | `server.js:12` |
| 요청별 대상 레포 | 쿼리 `?repo=<경로>` (페이지 URL과 API 모두) | 기본 대상 레포 | `server.js:179`, `public/app.js:13-28` |
| 바인딩 주소 | 고정 | `127.0.0.1` | `server.js:216` |

기동 시 콘솔에 접속 URL과 기본 레포 경로를 출력한다.

```
[Gitdonaldo] git engine ready -> http://127.0.0.1:4317
[Gitdonaldo] default repo: /path/to/cwd
```

데스크톱 앱 설정은 [desktop-shell](../01-backend/desktop-shell.md#설정-파일)의 `settings.json`을 쓴다.

## 설계 원칙

- **런타임 무의존성**: 백엔드는 `http`, `crypto`, `child_process`, `fs`, `path`, `url` 코어 모듈만 쓴다. 데스크톱 앱도 Electron이 내장한 Node로 돌기 때문에 추가 패키지가 없다. `electron`, `electron-builder`, `playwright-core`는 개발·빌드용(`devDependencies`)이다.
- **무상태 서버**: 서버는 캐시나 세션을 두지 않는다. 매 요청마다 git을 새로 실행한다.
- **브라우저 모드와 코드 공유**: 데스크톱 앱 전용 동작은 `window.gitdonaldo`가 있을 때만 켠다. 같은 `public/` 파일이 두 모드에서 돈다.
- **셸 미경유**: `execFile`로 인자 배열을 넘겨 셸 해석을 거치지 않는다. 자세한 내용은 [security](../05-quality/security.md).
- **안전한 구분자**: git 출력 필드 구분에 제어문자(US `\x1f`, RS `\x1e`)를 써서 커밋 메시지 내용과 충돌하지 않게 한다.
