# 디자인 토큰과 시각 규칙

근거: `public/style.css`, `public/app.js:3-8`

다크 테마 단일 모드다. 라이트 모드나 `prefers-color-scheme` 대응은 없다.

## 색상 토큰 (`:root`)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--bg` | `#15171c` | 페이지 배경, 그래프 노드 테두리 |
| `--bg2` | `#1b1e25` | 상단바·하단바 |
| `--bg3` | `#22262f` | 입력창, 버튼, 알약, 본문 상자, 목록 hover |
| `--panel` | `#1a1d24` | 사이드바·상세 패널 |
| `--line` | `#2b303b` | 경계선 |
| `--fg` | `#d4d8e0` | 기본 글자 |
| `--fg-dim` | `#8b93a3` | 보조 글자(작성자, 날짜, 해시, 섹션 제목) |
| `--accent` | `#46a6ff` | 강조(파랑): 포커스, hover, 로컬 브랜치 |
| `--accent2` | `#6ee7b7` | 강조(초록): HEAD, clean 상태 |

## 의미 색 (토큰 외 직접 사용)

| 의미 | 값 | 사용처 |
|---|---|---|
| 경고/변경 있음/태그 | `#f0b457` | dirty 상태, 태그 칩·점 |
| 에러 | `#f0768b` | 레포 로딩 에러 문구(`.repoinfo .error`) |
| 안내 | `var(--accent)` | 레포 선택 안내 문구(`.repoinfo .hint`) |
| 원격 브랜치 | `#b9c0cf` 글자, 회색 반투명 배경 | remote 칩 |
| 로컬 브랜치 칩 글자 | `#9fc8ff` | local 칩 |
| 선택 행 | `rgba(70,166,255,.14)` | 선택한 커밋 행 |
| hover 행 | `rgba(255,255,255,.035)` | 커밋 행 hover |

칩은 같은 계열 색으로 배경(약 15% 불투명), 글자, 테두리(약 40% 불투명)를 맞춘다.

레인 색 10종은 [commit-graph](../03-frontend/commit-graph.md#레인-색상) 참고.

## 치수

| 항목 | 값 |
|---|---|
| 상단바 높이 | 46px |
| 하단바 높이 | 24px |
| 그리드 열 | 230px / 1fr / 320px |
| 커밋 행 높이 | 28px (`--row-h`, JS `ROW_H`) |
| 레인 간격 | 18px (`--lane-w`, JS `LANE_W`) |
| 그래프 여백 | 14px (`--graph-pad`, JS `PAD`) |
| 노드 반지름 | 5px (`--node-r`, JS `NODE_R`) |
| 입력창 폭 | 320px (최대 화면 폭의 42%) |
| 모서리 반경 | 입력·버튼 6px, 목록 항목 5px, 칩 10px, 알약 9px |

CSS 변수 `--row-h` 등과 JS 상수는 값이 같아야 하지만 따로 정의돼 있다. 한쪽만 바꾸면 행과 그래프가 어긋난다. 실제 그래프는 JS 상수를 쓰고, 행 높이는 JS가 인라인 스타일로 다시 지정한다.

## 타이포그래피

| 용도 | 글꼴 | 크기 |
|---|---|---|
| 기본 | `-apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif` | 13px / 1.4 |
| 해시·stat·상세 해시 | `"SF Mono", ui-monospace, Menlo, monospace` | 11~12px |
| 섹션 제목 | 기본, 굵게 700, 자간 .6px | 10.5px |
| 칩·알약 | 기본, 굵게 600 | 10px |
| 상세 제목 | 기본 | 14px |

## 아이콘

- UI 안: 이모지 문자로 대체한다. 로고 `🔀`, 폴더 열기 `📂`, 새로고침 `⟳`, 태그 `🏷`, 상태 `✓` / `●`. 아이콘 폰트·이미지는 쓰지 않는다.
- 앱 아이콘: `build/icon.svg`(원본) → `build/icon.png`(1024×1024, electron-builder가 OS별 `.icns`/`.ico`로 변환). 둥근 사각형 `--bg` 그라데이션 위에 레인 색 노드 4개와 분기·합류 선. **임시 아이콘**이며 확정 전이다.

## 버튼

`#openBtn`, `#refreshBtn`은 같은 규칙을 쓴다: 배경 `--bg3`, 테두리 `--line`, 반경 6px, hover 시 테두리·글자 `--accent`.

## CSP 호환 규칙

서버가 `style-src 'self'`를 보내므로 HTML 문자열에 `style="…"` 속성을 쓰지 않는다. 색은 클래스로 준다. JS에서 `element.style.x = …`(CSSOM)로 바꾸는 것은 허용된다. `test/server.test.js`가 `index.html`, `app.js`에 `style="`가 없는지 검사한다.
