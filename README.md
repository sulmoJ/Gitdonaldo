# Gitdonaldo

최소 read-only git 클라이언트 macOS 데스크톱 앱. 런타임 의존성 0개, Node 코어 + 시스템 `git`만 사용한다.
커밋 그래프, 브랜치/태그, 커밋 상세를 본다. 백엔드와 UI 모두 내 노트북 안에서만 돈다.

기능 명세는 [`feature-spec/`](./feature-spec/README.md)에 있다.

## 데스크톱 앱

필요한 것: 시스템에 설치된 `git`. (설치 파일 사용자는 Node.js가 필요 없다.)

```bash
npm install          # 개발 도구(electron 등) 설치
npm run app          # 개발 실행
npm run dist         # macOS dmg (arm64, x64) → dist/  ※ macOS에서 실행
```

- 실행하면 `📂 열기`(또는 `Ctrl/Cmd+O`)로 git 저장소 폴더를 고른다. 다음 실행 때 마지막 레포가 열린다.
- 앱 내부 서버는 `127.0.0.1`의 임의 포트에 뜨고, 실행마다 바뀌는 토큰이 있어야 API에 접근할 수 있다.
- git을 못 찾으면 안내 창이 뜬다. 다른 위치의 git은 설정 파일(`settings.json`)의 `gitPath`로 지정한다.

## 설치 (macOS)

[Releases](https://github.com/sulmoj/gitdonaldo/releases)에서 내 Mac에 맞는 dmg를 받는다(Apple Silicon은 `arm64`, Intel은 `x64`).
아직 Apple 공증 전이라 처음 열 때 차단된다. Finder에서 Control-클릭 → 열기, 또는 macOS 15 이상은 시스템 설정 → 개인정보 보호 및 보안 → "그래도 열기".

## 출시

`package.json` 버전과 같은 태그(`v0.1.0` 등)를 push하면 CI가 dmg를 빌드해 GitHub Release에 올린다. 자세한 내용은 [packaging](./feature-spec/00-overview/packaging.md).

## 브라우저 모드 (개발용)

```bash
node server.js
```

- 포트 `4317`, `http://127.0.0.1:4317`
- 대상 레포: 기본은 현재 디렉터리. 상단 입력창에 경로를 넣거나 환경변수/쿼리로 지정

```bash
REPO=/path/to/repo PORT=5000 node server.js
# http://127.0.0.1:5000/?repo=/path/to/repo
```

## 테스트

```bash
npm test                 # 서버 단위 테스트 (node --test)
npm run test:e2e         # Electron E2E (Linux 헤드리스: xvfb-run -a npm run test:e2e)
npm run test:e2e -- dist/linux-unpacked/gitdonaldo   # 패키지된 앱 검사
```

## 모듈로 사용

```js
const { start } = require('./server.js');
const app = await start({ port: 0 }); // 0이면 빈 포트 자동 배정. token 옵션으로 API 보호
console.log(app.url);
await app.close();
```

## API

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/health` | 서버 생존 확인 |
| `GET /api/repo` | 레포 이름·현재 브랜치·HEAD |
| `GET /api/refs` | 로컬/원격 브랜치 + 태그 |
| `GET /api/commits?limit=N` | `--all --topo-order` 커밋 목록 |
| `GET /api/status` | working dir 변경 상태 |
| `GET /api/commit?hash=…` | 커밋 상세 + 파일 stat |

모든 엔드포인트는 `?repo=` 로 대상 레포를 바꿀 수 있다. 읽기 전용이다.
