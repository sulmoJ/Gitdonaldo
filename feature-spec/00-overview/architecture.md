# 아키텍처

## 구성 요소

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
| `server.js` | HTTP 서버, 라우팅, git 실행·파싱, 정적 파일 서빙 | 164 |
| `public/index.html` | 4영역 레이아웃 골격 | 59 |
| `public/app.js` | 클라이언트 상태, API 호출, 그래프 레이아웃·렌더링, 이벤트 | 261 |
| `public/style.css` | 디자인 토큰과 레이아웃 스타일 | 105 |
| `package.json` | 메타데이터, `start` 스크립트, `bin` 등록 | — |

빌드 단계가 없다. 브라우저는 `public/` 파일을 그대로 받는다.

## 데이터 흐름 (초기 로딩)

1. 브라우저가 `/`를 요청하면 서버가 `public/index.html`을 준다.
2. `app.js`의 `load()`가 API 4개를 **병렬로** 호출한다 (`public/app.js:231-232`).
   - `/api/repo`, `/api/refs`, `/api/commits?limit=400`, `/api/status`
3. 서버는 요청마다 대상 레포가 git 작업 트리인지 확인하고(`isRepo`), git 명령을 실행해 결과를 JSON으로 바꾼다.
4. 클라이언트는 커밋 목록으로 레인 배치를 계산하고(`layout`), SVG 그래프와 커밋 행 목록, 사이드바를 그린다.
5. 커밋 행을 클릭하면 `/api/commit?hash=`를 호출해 상세 패널을 채운다.

## 실행과 설정

```bash
node server.js        # 또는 npm start
```

| 설정 | 방법 | 기본값 | 근거 |
|---|---|---|---|
| 포트 | 환경변수 `PORT` | `4317` | `server.js:9` |
| 기본 대상 레포 | 환경변수 `REPO` | 서버 실행 디렉터리(`process.cwd()`) | `server.js:11` |
| 요청별 대상 레포 | 쿼리 `?repo=<경로>` (페이지 URL과 API 모두) | 기본 대상 레포 | `server.js:140`, `public/app.js:13-22` |
| 바인딩 주소 | 고정 | `127.0.0.1` | `server.js:161` |

기동 시 콘솔에 접속 URL과 기본 레포 경로를 출력한다.

```
[Gitdonaldo] git engine ready -> http://127.0.0.1:4317
[Gitdonaldo] default repo: /path/to/cwd
```

## 설계 원칙

- **무의존성**: `http`, `child_process`, `fs`, `path`, `url` 코어 모듈만 쓴다.
- **무상태 서버**: 서버는 캐시나 세션을 두지 않는다. 매 요청마다 git을 새로 실행한다.
- **셸 미경유**: `execFile`로 인자 배열을 넘겨 셸 해석을 거치지 않는다. 자세한 내용은 [security](../05-quality/security.md).
- **안전한 구분자**: git 출력 필드 구분에 제어문자(US `\x1f`, RS `\x1e`)를 써서 커밋 메시지 내용과 충돌하지 않게 한다.
