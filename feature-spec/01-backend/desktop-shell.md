# 데스크톱 셸 (Electron 메인 프로세스)

근거: `electron/main.js`, `electron/preload.js`

데스크톱 앱에서 백엔드를 호스팅하는 프로세스다. 기존 `server.js`를 같은 프로세스 안에서 띄우고, 그 주소를 샌드박스 창에 연다. UI는 브라우저 모드와 같은 `public/` 파일을 쓴다.

## 기동 순서

`electron/main.js:170-206`

1. **단일 인스턴스 잠금** (`app.requestSingleInstanceLock`). 이미 실행 중이면 새 프로세스는 바로 종료하고, 기존 창을 복원해 앞으로 가져온다.
2. `app.whenReady()` 후 **PATH 보강** (`extendPath`, `electron/main.js:45-55`). 아래 git 탐색 참고.
3. **git 확인**: `git --version`. 실패하면 오류 대화상자를 띄우고 종료한다.
   - 제목: `git을 찾을 수 없습니다`
   - 본문: git 설치 안내(https://git-scm.com/downloads), `settings.json` 경로와 `gitPath` 지정 방법
4. **토큰 생성**: `crypto.randomBytes(32)` → 64자 hex. 실행할 때마다 새로 만든다.
5. **백엔드 기동**: `start({ port: 0, defaultRepo: null, token })`. OS가 빈 포트를 배정하고, 기본 레포는 없다.
6. 하드닝 설정, IPC 등록, 메뉴 구성.
7. **창 열기**: `http://127.0.0.1:<port>/?token=<토큰>[&repo=<마지막 레포>]`
8. 기동 중 예외는 `Gitdonaldo를 시작하지 못했습니다` 대화상자로 보여주고 종료한다.

종료: 모든 창이 닫히면 앱을 끝낸다(macOS는 Dock에 남고, Dock 아이콘을 누르면 창을 다시 연다). `will-quit`에서 백엔드 `close()`.

## 창

`electron/main.js:76-96`

| 항목 | 값 |
|---|---|
| 크기 | 기본 1320×840, 최소 960×600 |
| 배경 | `#15171c` (로딩 중 흰 화면 깜빡임 방지) |
| 표시 | `ready-to-show` 이후 |
| `contextIsolation` | `true` |
| `nodeIntegration` | `false` |
| `sandbox` | `true` |
| `preload` | `electron/preload.js` |

## 메뉴

`electron/main.js:102-128`

| 메뉴 | 항목 |
|---|---|
| (macOS) 앱 메뉴 | 표준 `appMenu` |
| File | Open Repository… (`CmdOrCtrl+O`), Close(macOS) / Quit |
| View | Reload, Toggle DevTools, Reset/Zoom In/Zoom Out, Full Screen |
| Window | 표준 `windowMenu` |

Open Repository…는 렌더러에 `gitdonaldo:open-repo-request`를 보내고, 렌더러가 `📂 열기` 버튼과 같은 동작을 한다.

## preload 브리지 `window.gitdonaldo`

`electron/preload.js`. `contextBridge`로 아래 4개만 노출한다. 렌더러에서 Node API(`require`, `process`)는 쓸 수 없다.

| 멤버 | 타입 | 동작 |
|---|---|---|
| `isDesktop` | `true` | 데스크톱 모드 표시 |
| `selectRepo()` | `Promise<string \| null>` | OS 폴더 선택 대화상자. 취소하면 `null` |
| `rememberRepo(path)` | `void` | 마지막 레포로 저장 |
| `onOpenRepoRequest(cb)` | `void` | 메뉴의 Open Repository… 이벤트 구독 |

## IPC

`electron/main.js:145-163`

| 채널 | 방향 | 처리 |
|---|---|---|
| `gitdonaldo:select-repo` | invoke | `dialog.showOpenDialog({ properties: ['openDirectory'] })`, 제목 `Git 저장소 폴더 선택` |
| `gitdonaldo:remember-repo` | send | 빈 값이 아닌 문자열이면 `settings.json`의 `lastRepo`에 저장 |
| `gitdonaldo:open-repo-request` | main → renderer | 메뉴 클릭 알림 |

메인은 모든 IPC 요청의 보낸 프레임 URL이 앱 주소(`http://127.0.0.1:<port>`)인지 확인하고, 아니면 무시한다.

## 설정 파일

`<userData>/settings.json` (`electron/main.js:23-39`)

| OS | userData 기본 위치 |
|---|---|
| macOS | `~/Library/Application Support/Gitdonaldo` |
| Windows | `%APPDATA%\Gitdonaldo` |
| Linux | `~/.config/Gitdonaldo` |

| 키 | 타입 | 설명 |
|---|---|---|
| `lastRepo` | string | 마지막으로 연 레포 경로. 다음 실행 때 폴더가 있으면 자동으로 연다 |
| `gitPath` | string | (선택) git 실행 파일 경로. 이 파일의 디렉터리를 PATH 맨 앞에 넣는다 |

- 파일이 없거나 JSON이 깨졌으면 빈 설정으로 취급한다.
- 환경변수 `GITDONALDO_USER_DATA`가 있으면 userData 위치를 그 경로로 바꾼다(테스트 격리용).

## git 탐색

Finder·탐색기에서 실행한 앱은 셸의 PATH를 물려받지 않는다. 그래서 기동 시 OS별 기본 설치 위치를 PATH 앞에 붙인다(이미 있는 항목은 중복하지 않음).

| OS | 추가 경로 |
|---|---|
| macOS | `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin` |
| Linux | `/usr/local/bin`, `/usr/bin` |
| Windows | `C:\Program Files\Git\cmd`, `C:\Program Files (x86)\Git\cmd` |

`settings.json`의 `gitPath`가 있으면 그 디렉터리를 가장 앞에 둔다. 백엔드(`server.js`)는 바뀐 PATH로 `git`을 찾는다.

## 하드닝

`electron/main.js:132-143`

| 항목 | 동작 |
|---|---|
| 권한 요청 | 카메라·알림 등 모든 권한 요청·확인을 거부 |
| 페이지 이동 | `will-navigate`, `will-redirect`에서 앱 주소 밖이면 취소 |
| 새 창 | `setWindowOpenHandler` → 항상 `deny` |
| `<webview>` | 붙이기 차단 |

백엔드 쪽 방어(토큰, Host 검사, CSP)는 [server-runtime](./server-runtime.md#요청-보안-검사).
