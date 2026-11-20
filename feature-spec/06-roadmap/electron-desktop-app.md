# [계획] Electron 데스크톱 앱 패키징

| 항목 | 내용 |
|---|---|
| 상태 | **완료** — M1~M4 구현. 후속 과제만 남음 |
| 출시 결정 | **macOS 우선 출시** (2026-11-19). Windows 제외, Linux는 내부 검증용 |
| 구현 명세 | [architecture](../00-overview/architecture.md) · [desktop-shell](../01-backend/desktop-shell.md) · [server-runtime](../01-backend/server-runtime.md#요청-보안-검사) · [packaging](../00-overview/packaging.md) · [security](../05-quality/security.md) |
| 작성일 | 2026-11-18 |
| 기준 코드 | v0.1.0 (`f042d13`) |

> 이 문서는 계획 당시의 설계 기록이다. 실제 동작은 위 "구현 명세" 문서가 기준이며, 계획과 달라진 점은 [11. 구현 결과](#11-구현-결과)에 적었다.

## 1. 목표

지금은 `node server.js`로 서버를 띄우고 브라우저로 접속해야 한다. 이것을 **설치형 단일 데스크톱 앱**으로 바꾼다.

- 백엔드(git 실행)와 클라이언트(UI)가 모두 **설치한 사람의 노트북 안에서** 돈다. 외부 서버나 네트워크가 필요 없다.
- 사용자는 Node.js를 따로 설치하지 않는다. 앱을 설치하고 아이콘을 눌러 실행한다.
- 기존 기능(그래프, 사이드바, 커밋 상세, 읽기 전용 원칙)은 그대로 유지한다.

## 2. 범위

**포함**
- Electron 메인 프로세스에서 기존 백엔드를 띄우고 앱 창에서 기존 UI를 보여준다.
- 레포 선택을 OS 폴더 선택 대화상자로 바꾼다(경로 직접 입력도 유지).
- macOS, Windows, Linux 설치 파일을 만든다.

**제외(이번 단계 아님)**
- git 실행 파일 동봉. 시스템에 설치된 git을 쓴다.
- 자동 업데이트, 코드 서명·공증. 배포 단계에서 따로 정한다.
- 쓰기 작업(commit, checkout 등). 읽기 전용 원칙은 그대로다.

## 3. 아키텍처

```
┌──────────────────── Gitdonaldo.app (Electron) ────────────────────┐
│ Main process (Node)                                                │
│  ├─ server.js 모듈 → http 서버 127.0.0.1:<임의 포트>               │
│  │     └─ execFile('git', ...) → 로컬 저장소                        │
│  ├─ 폴더 선택 대화상자, 메뉴, 창 관리                               │
│  └─ preload.js (contextBridge) ── selectRepo() 등 최소 API 노출     │
│                                                                    │
│ Renderer (BrowserWindow) ── http://127.0.0.1:<포트>/ 로드           │
│  └─ 기존 public/ (index.html, app.js, style.css) 그대로              │
└────────────────────────────────────────────────────────────────────┘
```

### 방식 결정: 내장 로컬 HTTP 서버 유지

| 안 | 내용 | 판단 |
|---|---|---|
| **A. 내장 HTTP 서버 (채택)** | 메인 프로세스가 기존 `server.js`를 그대로 띄우고 창이 그 주소를 연다 | 기존 API·UI 코드를 거의 안 고친다. 브라우저 모드와 코드를 공유한다 |
| B. IPC 전환 | `fetch('/api/...')`를 `ipcRenderer.invoke`로 바꾸고 HTTP 서버를 없앤다 | 포트를 안 열어 더 안전하지만 API 계층을 다시 짜야 한다. 2단계 후보 |

A로 먼저 패키징하고, 보안 요구가 커지면 B로 옮긴다. API 핸들러를 순수 함수로 분리해 두면 B 전환 비용이 작다.

## 4. 변경 사항

### 4.1 `server.js` 모듈화
- 서버 생성을 `start({ port, repo }) → Promise<{ port, close }>` 함수로 감싸 `module.exports`로 내보낸다.
- `require.main === module`일 때만 지금처럼 바로 listen한다. `node server.js` 브라우저 모드는 계속 동작한다.
- `defaultRepo: null`을 주면 기본 레포 없이 뜬다. `?repo=` 없는 API 요청은 400 `no repo selected`.
- **구현됨(M1).** 실제 시그니처는 `start({ port, defaultRepo }) → Promise<{ port, url, server, close }>`.
- Electron에서는 `port: 0`으로 띄워 OS가 비어 있는 포트를 주게 한다(4317 충돌 방지).

### 4.2 Electron 진입점 (`electron/main.js`)
1. `app.whenReady()` → git 설치 확인(`git --version`). 없으면 안내 대화상자를 띄우고 종료.
2. `server.start({ port: 0 })`로 백엔드 기동.
3. `BrowserWindow`로 `http://127.0.0.1:<port>/` 로드.
4. 앱 종료 시 서버 `close()`.
- 단일 인스턴스(`app.requestSingleInstanceLock`): 두 번 실행하면 기존 창을 앞으로 가져온다.
- 마지막으로 연 레포 경로를 `app.getPath('userData')`에 저장해 다음 실행 때 연다.

### 4.3 preload와 UI
- `preload.js`에서 `contextBridge`로 `window.gitdonaldo.selectRepo()`만 노출한다(메인의 `dialog.showOpenDialog({ properties: ['openDirectory'] })` 호출).
- `app.js`: `window.gitdonaldo`가 있으면 상단에 "폴더 열기" 버튼을 보여준다. 없으면(브라우저 모드) 지금처럼 경로 입력만.

### 4.4 디렉터리 구조 (안)

```
Gitdonaldo/
├─ server.js            # start() export, 단독 실행도 가능
├─ public/              # UI (변경 최소)
├─ electron/
│  ├─ main.js
│  └─ preload.js
├─ build/               # 앱 아이콘 등 패키징 리소스
└─ package.json         # main: electron/main.js, scripts, build 설정
```

### 4.5 의존성
- **런타임 의존성 0개 원칙은 유지한다.** Electron이 Node를 내장하므로 앱 실행에 추가 패키지가 필요 없다.
- `devDependencies`만 추가: `electron`, `electron-builder`.
- 스크립트: `npm start`(브라우저 모드, 기존), `npm run app`(Electron 개발 실행), `npm run dist`(설치 파일 생성).

## 5. 패키징

`electron-builder`를 쓴다.

| OS | 산출물 | 비고 |
|---|---|---|
| macOS | `.dmg` (arm64, x64) | 서명·공증 전에는 첫 실행 시 Gatekeeper 경고 |
| Windows | NSIS `.exe` 설치 파일 | 서명 전에는 SmartScreen 경고 |
| Linux | `.AppImage` | — |

- `public/`은 asar 안에 넣어도 된다(Electron의 `fs`가 asar 읽기를 지원).
- 각 OS 설치 파일은 해당 OS에서 빌드하는 것을 기본으로 한다(CI 매트릭스는 후속).

## 6. 보안 요구사항

내장 서버가 루프백 포트를 열기 때문에, 같은 노트북의 다른 프로그램이나 웹페이지가 그 포트에 접근하지 못하게 막아야 한다.

| 항목 | 요구 |
|---|---|
| 창 설정 | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| 접근 토큰 | 실행할 때마다 임의 토큰을 만들어 창 URL에 넣고, API는 토큰이 없으면 403 |
| Host 검사 | `Host`가 `127.0.0.1:<port>`가 아니면 거부(DNS 리바인딩 차단) |
| 이동 제한 | `will-navigate`·`setWindowOpenHandler`로 앱 주소 밖으로 이동 차단 |
| CSP | `default-src 'self'` 응답 헤더 추가 |
| 바인딩 | `127.0.0.1` 고정(지금과 같음) |

[security.md](../05-quality/security.md)의 "남은 위험" 중 DNS 리바인딩·CSRF 항목을 이 단계에서 함께 해결한다.

## 7. 주의할 점

- **macOS PATH**: Finder에서 실행한 앱은 셸의 PATH를 물려받지 않는다. Homebrew git(`/opt/homebrew/bin`, `/usr/local/bin`)을 못 찾을 수 있으므로 git 탐색 경로를 보강하거나 설정에서 git 경로를 지정할 수 있게 한다.
- **Windows**: `git.exe`가 PATH에 있어야 한다(Git for Windows 기본 설치 시 등록됨).
- 앱 실행 디렉터리가 의미 없으므로 `DEFAULT_REPO`(cwd)는 Electron 모드에서 쓰지 않는다. 레포를 고르기 전에는 "폴더를 여세요" 안내를 보여준다.

## 8. 완료 기준

| 기준 | 결과 | 확인 방법 |
|---|---|---|
| Node.js가 없는 노트북에서 설치 파일로 설치하고 실행할 수 있다 | ✅ Linux 검증 / macOS는 CI E2E로 검증 | 패키지된 Linux 앱을 node 없는 PATH로 E2E, macOS는 CI의 패키지된 arm64 앱 E2E |
| 폴더 선택으로 로컬 저장소를 열면 그래프·사이드바·상세가 기존과 똑같이 동작한다 | ✅ | E2E (대화상자 스텁) |
| 앱을 다시 켜면 마지막 레포가 열린다 | ✅ | E2E 재실행 |
| git이 없으면 안내 후 종료한다 | ✅ | git을 숨기고 실행해 대화상자 화면 확인(수동) |
| 토큰 없는 외부 요청은 403이다 | ✅ | E2E, 단위 테스트 |
| `node server.js` 브라우저 모드도 계속 동작한다 | ✅ | 단위 테스트, Chromium 수동 확인 |

## 9. 단계 계획

| 단계 | 작업 | 결과물 |
|---|---|---|
| M1 ✅ | `server.js` 모듈화, `port: 0` 지원 | 브라우저 모드 회귀 없음. [server-runtime](../01-backend/server-runtime.md#startopts--모듈-api) |
| M2 ✅ | Electron 진입점, preload, 폴더 열기 버튼 | `npm run app`. [desktop-shell](../01-backend/desktop-shell.md) |
| M3 ✅ | 토큰·Host 검사·CSP 등 보안 항목 | [server-runtime](../01-backend/server-runtime.md#요청-보안-검사), [security](../05-quality/security.md) |
| M4 ✅ | electron-builder 설정, 아이콘, 3개 OS 설치 파일 | 설정 완료, Linux AppImage 빌드·검증. [packaging](../00-overview/packaging.md) |
| M5 ✅ | macOS 출시 준비: ad-hoc 서명, macOS CI(빌드·E2E), 태그 릴리스 | [packaging](../00-overview/packaging.md#ci-github-actions) |
| 후속 | Developer ID 서명·공증, 자동 업데이트, 정식 아이콘, IPC 전환(안 B) | — |

## 10. 미정 사항 (여전히 열려 있음)

- ~~배포 대상 OS 우선순위~~ → macOS 우선 출시로 결정
- 코드 서명 인증서 확보 여부
- 앱 이름·아이콘 확정

## 11. 구현 결과

계획과 달라지거나 구체화된 점:

| 항목 | 계획 | 구현 |
|---|---|---|
| 토큰 전달 | 창 URL에 넣고 API가 검사 | 창 URL `?token=` → `app.js`가 읽어 `x-gitdonaldo-token` **헤더**로 전송. 쿠키는 쓰지 않음(쿠키는 포트를 구분하지 않아 같은 노트북의 다른 로컬 서버로 새어 나갈 수 있음) |
| 토큰 검사 범위 | API | `/api/*` 전부(`/api/health` 포함). 정적 파일은 토큰 없이 제공 |
| Host 검사·보안 헤더 | 데스크톱 앱 | 브라우저 모드에도 적용(부작용 없음) |
| 레포 미선택 상태 | "폴더를 여세요" 안내 | 데스크톱 첫 실행 시 API를 호출하지 않고 안내만 표시 |
| git 경로 지정 | 설정에서 지정 가능하게 | `settings.json`의 `gitPath` (UI 없음, 오류 대화상자에서 안내) |
| 테스트 | — | 서버 단위 테스트 11개, Electron E2E 16개 항목(`npm run test:e2e`). E2E용 `playwright-core`를 devDependency로 추가 |
| 테스트 격리 | — | `GITDONALDO_USER_DATA` 환경변수로 userData 위치 변경 |
| 패키지 메타데이터 | — | `author`, `desktopName`, `publish: null` 추가 |
| Electron 버전 | — | `electron` 45.4.1, `electron-builder` 26.18.0 (정확한 버전 고정) |
