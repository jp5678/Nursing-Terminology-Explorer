# 간호 표준용어 탐색기 — 분류체계와 임상용어체계

분류체계 3개(KCD-9·ICD-10·ICD-11)와 임상용어체계 2개(SNOMED CT·ICNP)를 나란히 비교하며 배우는 인터랙티브 학습 앱입니다. 'AI융합 간호정보학'의 간호·의료 표준용어 단원용으로 만들었습니다.

- **접속 주소**: https://jp5678.github.io/Nursing-Terminology-Explorer/
- **성격**: 교육용 학습 도구입니다. 실제 의무기록·보험청구에는 각 표준 관리기관의 공식 원본을 사용해야 합니다.

## 구조

앱은 **`index.html` 한 파일**입니다. 서버, 빌드, 설치가 필요 없고, 파일을 브라우저로 열기만 해도 동작합니다.

```
index.html                    앱 전체 (스타일 + 화면 + 데이터 + 스크립트)
tools/
  check_app.mjs               앱 자동 점검 (데이터·구조·동작·접근성)
  verify_terminology.mjs      용어 데이터를 공식 원본과 대조
  set_pin.mjs                 교수자 기본 PIN 바꾸기
.github/workflows/check.yml   수정할 때마다 자동 점검 실행
package.json                  점검 도구용 설정 (앱 실행과는 무관)
.nojekyll                     GitHub Pages가 파일을 그대로 내보내게 하는 표시
```

`index.html` 안은 위에서부터 다음 순서입니다.

| 구역 | 내용 |
|---|---|
| `<style>` | 디자인 토큰(색·서체), 라이트·다크 테마, 화면별 스타일 |
| `<body>` | 상단 바, 메뉴(탭), 탭별 화면 틀, 푸터·고지문 |
| 첫째 `<script>` | `TERMINOLOGY_DATA` — 개념 40개의 5개 표준 코드 |
| 둘째 `<script>` | 동작 코드. 주석 제목 순서: Utilities → Data layer → Progress → Modal → Theme → Tabs → 탭 1~7 → init |

### 화면(탭)

| 탭 | 하는 일 | 주요 데이터 |
|---|---|---|
| 🔍 개념 검색·비교 | 한 개념의 5개 표준 코드를 나란히 비교. 한글·영문·약어·코드·초성 검색 | `TERMINOLOGY_DATA` |
| 🌳 계층 탐색 | 분류의 단일 계층과 SNOMED CT의 다중 부모(is-a) 비교 | 각 개념의 `kcd9.chapter/block`, `snomed.parents` |
| 🏥 상호운용성 | 두 병원의 로컬 용어를 표준코드로 매핑해 통합 | `INTEROP_TERMS`, `INTEROP_TARGETS` |
| 📝 간호기록 코딩 | 가상 간호기록에서 개념을 추출해 코딩 | `RECORDS` |
| 🎯 퀴즈 | 문항 풀 50개에서 10문항 무작위 출제(형식마다 1문항 이상), 오답 재풀이. 형식: O/X·5지 선다·복수 선택·짝짓기·분류하기(끌어다 놓기). 4지 선다는 쓰지 않음 | `QUIZ_POOL`, `QZ_TYPE` |
| 📚 표준용어 개요 | 개발 목적, 5개 표준 소개, 매핑 불일치 사례, 비교표, 연표, 공식 원본 | 정적 HTML + `MISMATCH` |
| 🔎 검증 미션 | 학생이 앱 수록값을 공식 원본과 대조해 제출. 반·학번·이름을 적고 JSON·CSV·문서(.docx, Google 문서로 열림)로 내보냄 | `V_TYPES`, `V_SOURCES` |
| 🛠 교수자 | 개념 추가·수정, 검증 표시, JSON 내보내기·불러오기, 학생 제출 집계 | PIN 필요 |

### 저장

모든 기록은 **접속한 브라우저의 localStorage**에만 저장됩니다(키 이름은 `nte.`로 시작). 서버로 보내는 정보는 없습니다.

- 학생: 학습 진도, 퀴즈 기록, 검증 미션 판정, 테마

학습 진도는 탭 방문이 아니라 **활동**으로 잽니다(`progressItems`). 개념 직접 비교, 다중 부모 계층 확인, 상호운용성 매핑, 간호기록 코딩, 퀴즈 완주와 7점 이상, 매핑 불일치 사례 확인, 검증 미션 판정과 내보내기의 9개 활동이며, 일부만 해도 그만큼 퍼센트에 반영됩니다.

- 교수자: 편집한 개념 데이터, 불러온 학생 제출, 변경한 PIN(해시)

교수자가 편집한 내용도 그 브라우저에만 남습니다. 모든 학생에게 반영하려면 `index.html`의 `TERMINOLOGY_DATA`를 고쳐 배포해야 합니다. 교수자 모드의 **JSON 내보내기**로 편집본을 받아 옮기면 됩니다.

## 데이터 갱신 절차

1. `index.html`의 `TERMINOLOGY_DATA`(또는 `RECORDS`, `QUIZ_POOL` 등)를 고칩니다.
2. 코드·명칭은 반드시 **공식 원본에서 확인한 값**만 넣습니다. 확인하지 못한 항목은 `verified:false`로 둡니다. 기준은 `TERMINOLOGY_DATA` 위 주석의 "정확성 규칙"에 있습니다.
3. 공식 원본과 대조합니다.
   ```bash
   node tools/verify_terminology.mjs
   ```
4. 앱 자동 점검을 돌립니다.
   ```bash
   node tools/check_app.mjs
   ```
5. 커밋하고 `index` 브랜치에 병합하면 배포됩니다.

표준은 계속 개정됩니다. KCD 개정이나 SNOMED CT·ICD-11의 새 릴리스가 나오면 3번 대조를 다시 하십시오.

## 점검 도구

처음 한 번 설치합니다(Node.js 18 이상).

```bash
npm install
```

```bash
npx playwright install chromium
```

| 명령 | 하는 일 |
|---|---|
| `node tools/check_app.mjs` | 브라우저로 앱을 열어 전 탭을 조작하며 데이터 무결성·구조·동작·접근성(WCAG 2 A/AA) 점검. 문제가 있으면 목록을 출력하고 종료 코드 1 |
| `node tools/check_app.mjs --no-axe` | 접근성 검사 생략 |
| `node tools/verify_terminology.mjs` | KCD-9(KOICD)·ICD-10·ICD-11(WHO) 공식 원본과 대조. SNOMED CT·ICNP는 기관 Snowstorm 서버 주소가 있을 때만(`--snowstorm`) |
| `node tools/verify_terminology.mjs --only order` | 화면 목록의 가나다순 정렬만 검사(인터넷 불필요) |

`check_app.mjs`는 파일을 수정하지 않으며 인터넷이 필요 없습니다. 풀 요청(PR)을 만들거나 `index` 브랜치에 반영할 때마다 GitHub Actions가 같은 점검을 자동으로 실행합니다.

## 교수자 PIN

- `index.html`에는 PIN이 아니라 **PBKDF2-SHA256 해시**만 들어 있습니다(`DEFAULT_PIN_HASH`).
- 기본 PIN을 바꾸려면 아래를 실행해 새 PIN을 입력한 뒤, 바뀐 `index.html`을 커밋·배포합니다.
  ```bash
  node tools/set_pin.mjs
  ```
- 앱의 **PIN 변경** 버튼은 그 브라우저에서만 적용되며, 기본 PIN보다 우선합니다.
- 한계: 숫자 PIN은 경우의 수가 적어, 해시가 공개된 이상 작정하고 대입하면 찾아낼 수 있습니다. 또 이 저장소의 과거 이력에는 예전 기본 PIN이 평문으로 남아 있으므로, 숨기려면 **PIN을 새 값으로 바꿔야** 합니다. 교수자 모드는 그 브라우저의 사본만 편집하므로, 뚫려도 다른 학생의 화면에는 영향이 없습니다.

## 배포

GitHub Pages가 **`index` 브랜치**의 내용을 그대로 내보냅니다. `index`에 병합하면 1~2분 안에 반영됩니다. 학생 브라우저에 이전 화면이 남아 있으면 새로고침(Ctrl+F5)합니다.

## 공식 원본

- KCD-9: [KOICD 질병분류 정보센터](https://www.koicd.kr/kcd/kcd9.do) · [통계분류포털](https://kssc.kostat.go.kr)
- ICD-10: [WHO ICD-10 Browser (2019)](https://icd.who.int/browse10/2019/en)
- ICD-11: [WHO ICD-11 Browser](https://icd.who.int/browse/2026-01/mms/en) · [ICD-11 Reference Guide](https://icdcdn.who.int/icd11referenceguide/en/html/index.html)
- SNOMED CT: [SNOMED International](https://www.snomed.org) · [SNOMED CT Browser](https://snomedbrowser.org/)
- ICNP: [ICN ICNP Browser (2019 릴리스까지의 레거시)](https://www.icn.ch/icnp-browser). 현재 내용은 SNOMED CT 안에서 관리됩니다.

---

© 2026 제프리 교수 · 청암대학교 간호학과. All rights reserved.
