# API 엔드포인트

공통 규약은 [api-conventions.md](./api-conventions.md). 내부 git 명령과 파싱은 [git-engine.md](../01-backend/git-engine.md).

| 엔드포인트 | 설명 | 레포 검사 | 프론트 사용 |
|---|---|---|---|
| `GET /api/health` | 서버 생존 확인 | 안 함 | 안 씀 |
| `GET /api/repo` | 레포 이름, 경로, 현재 브랜치, HEAD | 함 | 초기 로딩 |
| `GET /api/refs` | 로컬·원격 브랜치, 태그 | 함 | 초기 로딩 |
| `GET /api/commits` | 커밋 목록(그래프용) | 함 | 초기 로딩 (`limit=400`) |
| `GET /api/status` | 작업 트리 변경 상태 | 함 | 초기 로딩 |
| `GET /api/commit` | 커밋 하나의 상세 | 함 | 커밋 행 클릭 |

---

## GET /api/health

서버가 떠 있는지 확인한다. `repo`가 잘못돼도 200이다.

**응답 200**
```json
{ "ok": true }
```

---

## GET /api/repo

**응답 200**
```json
{
  "path": "/home/user/Gitdonaldo",
  "name": "Gitdonaldo",
  "currentBranch": "main",
  "head": "f042d13c389aba6c48ee07d9cb01b86995f69266"
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `path` | string | 작업 트리 최상위 경로. 조회 실패 시 요청한 `repo` 값 |
| `name` | string | `path`의 마지막 디렉터리 이름 |
| `currentBranch` | string | 현재 브랜치 약칭. detached HEAD면 `"HEAD"`, 조회 실패 시 `"(detached)"` |
| `head` | string \| null | HEAD 커밋 해시. 커밋이 없으면 `null` |

---

## GET /api/refs

**응답 200** — 배열. git `for-each-ref` 정렬(refname 사전순)을 따른다.
```json
[
  { "oid": "f042d13c…", "refname": "refs/heads/main", "short": "main", "type": "local", "isHead": true },
  { "oid": "f042d13c…", "refname": "refs/remotes/origin/main", "short": "origin/main", "type": "remote", "isHead": false },
  { "oid": "9a1b2c3d…", "refname": "refs/tags/v0.1.0", "short": "v0.1.0", "type": "tag", "isHead": false }
]
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `oid` | string | ref가 가리키는 객체 해시. 주석 태그는 태그 객체 해시 |
| `refname` | string | 전체 ref 이름 |
| `short` | string | 축약 이름 |
| `type` | `"local"` \| `"remote"` \| `"tag"` | ref 종류 |
| `isHead` | boolean | 현재 체크아웃된 로컬 브랜치면 `true` |

조회 실패 시 빈 배열 `[]` (에러 아님).

---

## GET /api/commits

**쿼리**

| 이름 | 기본값 | 범위 | 설명 |
|---|---|---|---|
| `limit` | 300 | 최대 2000 | 가져올 커밋 수. 숫자가 아니거나 0이면 300, 2000을 넘으면 2000 |

**응답 200** — 배열. 자식이 부모보다 먼저 나오는 순서(그 안에서 커밋 날짜 내림차순).
```json
[
  {
    "hash": "f042d13c389aba6c48ee07d9cb01b86995f69266",
    "parents": [],
    "author": "Jane Doe",
    "email": "jane@example.com",
    "date": "2026-11-18T10:23:56+09:00",
    "subject": "feat: Gitdonaldo — minimal read-only git client"
  }
]
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `hash` | string | 커밋 해시 |
| `parents` | string[] | 부모 해시. 루트는 `[]`, 머지는 2개 이상 |
| `author` / `email` | string | 작성자 이름·이메일 |
| `date` | string | 작성자 날짜(ISO 8601) |
| `subject` | string | 커밋 메시지 첫 줄 |

커밋이 없는 저장소는 빈 배열 `[]`.

---

## GET /api/status

**응답 200**
```json
{
  "branchLine": "main...origin/main [ahead 1]",
  "files": [
    { "xy": " M", "path": "server.js" },
    { "xy": "??", "path": "feature-spec/" }
  ],
  "count": 2
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `branchLine` | string | `git status -b`의 브랜치 줄에서 `## `를 뗀 값 |
| `files[].xy` | string | porcelain v1 2글자 상태 코드(인덱스, 작업 트리) |
| `files[].path` | string | 경로. 이름 변경은 `"old -> new"` |
| `count` | number | `files` 길이 |

조회 실패 시 `{ "branchLine": "", "files": [], "count": 0 }`.

---

## GET /api/commit

**쿼리**

| 이름 | 필수 | 설명 |
|---|---|---|
| `hash` | 예 | 커밋 해시. 16진수 4~40자 |

**응답 200**
```json
{
  "hash": "f042d13c389aba6c48ee07d9cb01b86995f69266",
  "parents": [],
  "author": "Jane Doe",
  "email": "jane@example.com",
  "authorDate": "2026-11-18T10:23:56+09:00",
  "committer": "Jane Doe",
  "commitDate": "2026-11-18T10:23:56+09:00",
  "subject": "feat: Gitdonaldo — minimal read-only git client",
  "body": "Zero-dependency git client web app ...",
  "stat": " README.md | 36 ++++\n server.js | 164 ++++++\n 2 files changed, 200 insertions(+)"
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `hash`, `parents` | | `/api/commits`와 같음 |
| `author`, `email`, `authorDate` | string | 작성자 정보 |
| `committer`, `commitDate` | string | 커미터 정보 |
| `subject` | string | 제목 |
| `body` | string | 본문(제목 제외). 없으면 `""` |
| `stat` | string | `git show --stat` 출력(요약 줄 제외), 사람이 읽는 텍스트 |

**에러**

| 조건 | 코드 | 본문 |
|---|---|---|
| `hash` 누락·형식 오류 | 500 | `{ "error": "bad hash" }` |
| 커밋 없음·모호한 짧은 해시 | 500 | `{ "error": "...", "stderr": "fatal: ..." }` |
