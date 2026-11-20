# 패키징, CI, 배포

근거: `package.json`의 `build` 필드, `build/`, `.github/workflows/ci.yml`

## 출시 대상

**macOS 우선 출시** (2026-11-19 결정). Windows는 출시 대상에서 뺐고 설정도 지웠다. Linux AppImage 설정은 Linux 개발 환경에서 패키지된 앱을 검증하는 용도로만 남겼다(출시하지 않음).

## 스크립트

| 명령 | 동작 |
|---|---|
| `npm run app` | Electron 개발 실행(`electron .`) |
| `npm run dist` | macOS `.dmg` 생성(arm64, x64) → `dist/`. **macOS에서만 실행 가능** |
| `npm run dist:linux` | Linux AppImage 생성(내부 검증용) |
| `npm test` | 서버 단위 테스트 |
| `npm run test:e2e [바이너리 경로]` | Electron E2E. 인자를 주면 패키지된 앱을 검사 |

두 `dist` 스크립트 모두 `--publish never`를 붙여, CI에서 태그 빌드를 해도 electron-builder가 스스로 업로드하지 않게 한다. 업로드는 CI의 release 잡이 맡는다.

## macOS 산출물

| 파일 | 대상 Mac |
|---|---|
| `Gitdonaldo-<버전>-arm64.dmg` | Apple Silicon (M1 이후) |
| `Gitdonaldo-<버전>-x64.dmg` | Intel |

- 사용자 Mac에는 Node.js가 필요 없다. git만 있으면 된다(Xcode Command Line Tools의 `/usr/bin/git` 또는 Homebrew git).
- 앱 asar에는 `server.js`, `public/**`, `electron/**`, `package.json`만 들어간다(런타임 의존성 0개).

## 서명 상태

| 항목 | 현재 | 인증서 확보 후 |
|---|---|---|
| 코드 서명 | **ad-hoc**(`mac.identity: "-"`) | Developer ID Application 인증서(`CSC_LINK`, `CSC_KEY_PASSWORD` 시크릿) |
| hardened runtime | 끔(`hardenedRuntime: false`) | 켬 |
| 공증(notarization) | 안 함 | Apple ID / API 키로 공증 |

ad-hoc 서명을 쓰는 이유: 서명을 완전히 건너뛰면 패키징 과정에서 Electron 바이너리의 원래 서명이 깨져 Apple Silicon에서 "손상된 앱"으로 실행이 거부된다. ad-hoc 서명은 이를 막지만 Apple이 발급한 신원이 없어, **인터넷에서 받은 dmg는 Gatekeeper가 막는다.** 지금은 사용자에게 아래 방법을 안내해야 한다.

- Finder에서 앱을 **Control-클릭 → 열기 → 열기** (macOS 14 이하)
- macOS 15 이상: 한 번 실행을 시도한 뒤 **시스템 설정 → 개인정보 보호 및 보안 → "그래도 열기"**
- 또는 터미널: `xattr -dr com.apple.quarantine /Applications/Gitdonaldo.app`

hardened runtime을 끈 이유: ad-hoc 서명과 hardened runtime을 같이 쓰면 라이브러리 검증 때문에 Electron 프레임워크 로딩이 실패할 수 있다(electron-builder 문서 권고).

## electron-builder 설정 요약

| 키 | 값 |
|---|---|
| `appId` | `io.gitdonaldo.app` |
| `productName` | `Gitdonaldo` |
| `directories.output` / `buildResources` | `dist` / `build` |
| `files` | `server.js`, `public/**`, `electron/**`, `package.json` |
| `publish` | `null` |
| `mac.target` | `dmg` × `arm64`, `x64` |
| `mac.category` | `public.app-category.developer-tools` |
| `mac.artifactName` | `${productName}-${version}-${arch}.${ext}` |
| `mac.identity` / `hardenedRuntime` | `"-"` / `false` (위 "서명 상태") |
| `linux.*` | AppImage x64, 내부 검증용 |

## CI (GitHub Actions)

`.github/workflows/ci.yml`

| 트리거 | 실행되는 잡 |
|---|---|
| `master` push, PR, 수동 실행 | `unit` → `mac` |
| `v*` 태그 push | `unit` → `mac` → `release` |

| 잡 | 러너 | 단계 |
|---|---|---|
| `unit` | ubuntu-latest | `npm ci`(Electron 바이너리 다운로드 생략) → `npm test` |
| `mac` | macos-latest (Apple Silicon) | `npm ci` → `npm test` → E2E(개발 앱) → `npm run dist` → `codesign --verify`·`lipo`로 두 앱 번들 확인 → E2E(패키지된 arm64 앱) → dmg를 아티팩트로 업로드(14일 보관) |
| `release` | ubuntu-latest | 태그가 `package.json` 버전과 같은지 확인 → dmg 2개를 첨부해 GitHub Release 생성(릴리스 노트 자동 생성) |

- 패키지된 x64 앱은 빌드와 번들 검사만 한다. Apple Silicon 러너에서는 실행 E2E를 돌리지 않는다.
- CI의 Node 버전은 저장소 루트 `.nvmrc`(Node 26 LTS)를 따른다. 액션은 Node 24 런타임 버전(checkout·setup-node·upload-artifact v7, download-artifact v8)을 쓴다.
- 워크플로 기본 권한은 `contents: read`, release 잡만 `contents: write`.
- PR에서는 같은 브랜치의 이전 실행을 취소한다.

## 출시 절차

1. `package.json`의 `version`을 올리고 master에 머지
2. 같은 버전으로 태그를 만들어 push
   ```bash
   git tag v0.2.1
   git push origin v0.2.1
   ```
3. CI가 끝나면 GitHub Releases에 dmg 2개가 올라간다. 태그와 버전이 다르면 release 잡이 실패한다.

## 아이콘

`build/icon.png`(1024×1024)를 electron-builder가 `.icns`로 변환한다. 원본은 `build/icon.svg`. 현재는 **임시 아이콘**이다.

## 아직 하지 않은 것

- Developer ID 서명·공증(인증서 필요)
- 자동 업데이트
- 정식 아이콘
