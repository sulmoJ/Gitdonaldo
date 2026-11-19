# Git 실행 엔진

근거: `server.js:14-115`. 서버는 git 라이브러리를 쓰지 않고 시스템 `git` CLI를 실행해 출력을 파싱한다.

## 실행 래퍼 `gitRun(repo, args, { input, timeout })` / `git(repo, args)`

`git()`은 `gitRun()`의 stdout만 돌려주는 단축형이다. 쓰기 API는 [api-write](../02-api/api-write.md).

- `execFile('git', ['-C', repo, ...args], { maxBuffer, timeout, env })`
  - `input`을 stdin으로 넘기고 바로 닫는다(커밋·태그 메시지는 `-F -`). 입력이 없어도 stdin을 닫아 git이 기다리지 않게 한다.
  - `timeout` 기본 30초, fetch/pull/push는 120초. 넘으면 SIGTERM, 에러에 `timedOut: true`.
  - 환경변수: `GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`, `GIT_SEQUENCE_EDITOR=true`, `GIT_MERGE_AUTOEDIT=no`, `GIT_PAGER=cat`, `LC_ALL=C`(메시지 파싱을 위해 영어 출력).
  - 실패 시 에러에 `stderr`(자격정보 마스킹), `stdout`, `exitCode`, `timedOut`을 붙인다. 충돌 판별은 stdout·stderr의 `CONFLICT` 등을 본다.
  - `-C <repo>`로 대상 저장소를 지정한다. 서버 프로세스의 작업 디렉터리는 바꾸지 않는다.
  - 셸을 거치지 않으므로 인자의 공백·특수문자가 셸 문법으로 해석되지 않는다.
- `maxBuffer` 기본값 64 MiB. 넘으면 에러.
- 상위 핸들러가 에러를 `ApiError`(`code`, HTTP 상태)로 바꿔 응답한다. 인증 실패 401, 원격 연결 실패 502, 시간 초과 504, 그 밖 500 `GIT_FAILED`.
- 성공 시 stdout 문자열로 resolve.

## 출력 구분자

| 상수 | 값 | 용도 |
|---|---|---|
| `US` | `\x1f` (Unit Separator) | 한 레코드 안의 필드 구분 |
| `RS` | `\x1e` (Record Separator) | 커밋 레코드 구분 (`log`) |

커밋 제목·본문에 탭, 파이프, 줄바꿈이 있어도 필드가 깨지지 않게 하려고 제어문자를 쓴다.

## 명령별 명세

### 레포 판별 — `isRepo`

```
git -C <repo> rev-parse --is-inside-work-tree
```
stdout이 `true`면 참. 명령이 실패하면(경로 없음, git 저장소 아님) 거짓. bare 저장소는 `false`를 출력하므로 거짓으로 처리된다.

### 레포 정보 — `apiRepo`

세 명령을 병렬 실행한다. 각각 실패해도 기본값으로 대체하므로 이 핸들러는 예외를 던지지 않는다.

| 필드 | 명령 | 실패 시 |
|---|---|---|
| `path` | `rev-parse --show-toplevel` | 요청한 repo 문자열 |
| `currentBranch` | `symbolic-ref --quiet --short HEAD` | `(detached)` |
| `head` | `rev-parse --verify --quiet HEAD` | `null` |
| `name` | `path`의 basename | — |

detached HEAD면 `symbolic-ref`가 실패하므로 `(detached)`가 된다. 커밋이 하나도 없는 새 브랜치는 이름이 그대로 나온다.

### ref 목록 — `apiRefs`

```
git for-each-ref --format=%(objectname)US%(refname)US%(refname:short)US%(HEAD)US%(*objectname)US%(upstream:short) refs/heads refs/remotes refs/tags
```

- `refname` 접두사로 `type`을 정한다: `refs/heads/` → `local`, `refs/remotes/` → `remote`, 나머지(`refs/tags/`) → `tag`.
- `%(HEAD)`가 `*`면 `isHead: true` (현재 체크아웃된 로컬 브랜치).
- 주석 태그(annotated tag)는 `objectname`이 **태그 객체** 해시다. `%(*objectname)`(peel)이 비어 있지 않으면 `target`으로 내보내고, 화면은 그 커밋에 칩을 붙인다.
- `%(upstream:short)`가 있으면 `upstream`.
- `refs/remotes/origin/HEAD` 같은 심볼릭 ref도 `remote`로 포함된다.
- 명령 실패 시 빈 배열.

### 커밋 목록 — `apiCommits`

```
git log --all --date-order --max-count=<limit> --pretty=format:%H US %P US %an US %ae US %aI US %s RS
```

- `--all`: 모든 ref에서 도달 가능한 커밋.
- `--date-order`의 결과는 "자식이 부모보다 먼저 나오고, 그 안에서는 커밋 날짜 순"이다. 그래프 레이아웃은 자식 → 부모 순서를 전제한다.
- 레코드는 `RS`로 자르고, 각 레코드 앞의 줄바꿈을 지운 뒤 `US`로 필드를 나눈다.
- `parents`는 공백으로 나눈 해시 배열. 루트 커밋은 `[]`, 머지 커밋은 2개 이상.
- `date`는 작성자 날짜(ISO 8601, `%aI`).
- 커밋이 없는 저장소: stderr에 `does not have any commits`/`unknown revision`이 있으면 빈 배열을 반환한다. 그 밖의 실패는 예외(500).

### 작업 트리 상태 — `apiStatus`

```
git status --porcelain=v1 -z -b --untracked-files=all
```

`-z`라 경로를 따옴표 없이 NUL로 구분한다. 이름 변경(`R`)·복사(`C`)는 다음 NUL 필드가 원래 경로(`origPath`)다. `staged`/`unstaged`/`untracked`/`conflicted` 판별은 `parseStatusZ()`.

- `## `로 시작하는 줄은 브랜치 줄 → `branchLine` (예: `main...origin/main [ahead 1]`).
- 나머지 줄은 `xy`(앞 2글자 상태 코드)와 `path`(4번째 글자부터)로 나눈다.
- 이름 변경은 `path`가 새 경로, `origPath`가 원래 경로다.
- 명령 실패 시 빈 결과(`files: []`, `count: 0`).

### 커밋 상세 — `apiCommit`

1. 해시 검증: `/^[0-9a-fA-F]{4,40}$/`에 맞지 않으면 400 `bad hash`.
2. 메타데이터:
   ```
   git show -s --pretty=format:%H US %P US %an US %ae US %aI US %cn US %cI US %s US %b <hash>
   ```
3. 파일 통계:
   ```
   git show --stat --oneline --no-color <hash>
   ```
   첫 줄(oneline 요약)을 버리고 나머지를 trim해서 `stat`에 넣는다. 실패하면 빈 문자열.

- 짧은 해시가 모호하거나 없는 커밋이면 메타데이터 명령이 실패해 500.
- 본문 `%b`가 마지막 필드라서 본문에 `US`가 없는 한 안전하다.
- 머지 커밋의 `--stat`은 git 기본 동작상 비어 있을 수 있다.
