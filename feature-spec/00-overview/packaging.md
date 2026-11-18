# 패키징과 배포

근거: `package.json`의 `build` 필드, `build/`

## 스크립트

| 명령 | 동작 |
|---|---|
| `npm run app` | Electron 개발 실행(`electron .`) |
| `npm run dist` | 현재 OS용 설치 파일 생성 → `dist/` |
| `npm run dist:mac` / `dist:win` / `dist:linux` | 대상 OS 지정 |
| `npm test` | 서버 단위 테스트 |
| `npm run test:e2e [바이너리 경로]` | Electron E2E. 인자를 주면 패키지된 앱을 검사 |

## 산출물

| OS | 형식 | 아키텍처 | 파일 이름 예 |
|---|---|---|---|
| macOS | `.dmg` | arm64, x64 | `Gitdonaldo-0.1.0-arm64.dmg` |
| Windows | NSIS 설치 파일 `.exe` (설치 위치 선택 가능, 사용자 단위 설치) | x64 | `Gitdonaldo Setup 0.1.0.exe` |
| Linux | `.AppImage` | x64 | `Gitdonaldo-0.1.0.AppImage` |

- 각 OS 설치 파일은 **해당 OS에서** 빌드한다. macOS `.dmg`는 macOS에서만 만들 수 있다.
- Linux AppImage는 약 120 MB다(Electron 런타임 포함).
- 사용자 PC에는 Node.js가 필요 없다. git만 있으면 된다.

## electron-builder 설정 요약

| 키 | 값 |
|---|---|
| `appId` | `io.gitdonaldo.app` |
| `productName` | `Gitdonaldo` |
| `directories.output` / `buildResources` | `dist` / `build` |
| `files` | `server.js`, `public/**`, `electron/**`, `package.json` |
| `publish` | `null` (자동 업데이트 메타데이터를 만들지 않음) |
| `mac.category` | `public.app-category.developer-tools` |
| `linux.category` / `executableName` | `Development` / `gitdonaldo` |
| `desktopName` + `linux.syncDesktopName` | `gitdonaldo.desktop` (Linux 작업 표시줄 아이콘 연결) |

`files`가 앱 asar 안에 넣는 것은 위 네 가지뿐이다. `node_modules`, 테스트, 문서, 아이콘 원본은 들어가지 않는다(런타임 의존성 0개).

## 아이콘

`build/icon.png`(1024×1024)를 electron-builder가 `.icns`/`.ico`로 변환한다. 원본은 `build/icon.svg`. 현재는 **임시 아이콘**이다.

## 검증 상태 (v0.1.0)

| 항목 | 상태 |
|---|---|
| Linux AppImage 빌드 | ✅ 빌드 성공 |
| 패키지된 Linux 앱 E2E (PATH에 node 없음) | ✅ 16개 항목 통과 |
| AppImage 파일 직접 실행 | ✅ 기동, 백엔드 로그 확인 |
| macOS `.dmg`, Windows `.exe` 빌드 | ⬜ 미검증 — 해당 OS 환경 필요 |

## 아직 하지 않은 것

- 코드 서명·공증: 서명 전에는 macOS Gatekeeper, Windows SmartScreen 경고가 뜬다.
- 자동 업데이트
- OS별 빌드 CI(GitHub Actions 매트릭스)

자세한 내용은 [로드맵](../06-roadmap/electron-desktop-app.md#9-단계-계획).
