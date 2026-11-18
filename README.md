# Gitdonaldo

의존성 0개의 최소 read-only git 클라이언트 웹앱. Node 코어 + 시스템 `git`만 사용한다.
커밋 그래프, 브랜치/태그, 커밋 상세를 브라우저에서 본다.

## 실행

```bash
node server.js
```

- 포트 `4317`, `http://127.0.0.1:4317`
- 대상 레포: 기본은 현재 디렉터리. 상단 입력창에 경로를 넣거나 환경변수/쿼리로 지정

```bash
REPO=/path/to/repo PORT=5000 node server.js
# http://127.0.0.1:4317/?repo=/path/to/repo
```

## 테스트

```bash
npm test
```

Node 내장 테스트 러너(`node --test`)를 쓴다. 추가 패키지는 필요 없다.

## 모듈로 사용

```js
const { start } = require('./server.js');
const app = await start({ port: 0 }); // 0이면 빈 포트 자동 배정
console.log(app.url);
await app.close();
```

## API

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/repo` | 레포 이름·현재 브랜치·HEAD |
| `GET /api/refs` | 로컬/원격 브랜치 + 태그 |
| `GET /api/commits?limit=N` | `--all --topo-order` 커밋 목록 |
| `GET /api/status` | working dir 변경 상태 |
| `GET /api/commit?hash=…` | 커밋 상세 + 파일 stat |

모든 엔드포인트는 `?repo=` 로 대상 레포를 바꿀 수 있다. 읽기 전용이다.
