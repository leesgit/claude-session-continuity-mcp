# 세션 연속성 보장 평가지 — npm v1.13.2 vs 로컬 v1.15.0

> 대상: `claude-session-continuity-mcp` — SessionEnd 훅이 다음 세션이 이어받을 컨텍스트(last_work / solutions / 메타)를 저장하는 능력.
> 평가 방식: 7개 합성 fixture(다국어 KR+EN)를 두 버전으로 실행한 벤치 workspace 2개를 **독립 SELECT로 재검증**. 실 프로덕션 DB는 읽기 전용 SELECT만.
> 원칙: sycophancy 금지. 모든 점수에 SQL/파일 출처 명시. 동등한 부분은 동등하다고 표기.

---

## 0. 독립 검증 결과 (제공 수치 vs 내 재확인)

두 벤치 DB를 직접 열어 재확인했다. 제공된 수치는 **전부 일치**한다.

| 주장 | 재검증 방법 | 결과 |
|---|---|---|
| last_work 오염 npm 2/6, 로컬 0/6 | `SELECT last_work FROM sessions` 양쪽 | ✅ 일치 (아래 표) |
| slash 요청 정확도 | fx1/fx2 fixture vs 저장값 대조 | ✅ npm은 커맨드 문서 제목 저장, 로컬은 실제 요청 |
| solutions 노이즈 npm 4건중 2건 | `SELECT error_signature,solution FROM solutions` | ✅ npm 4건(노이즈 2), 로컬 2건(진짜만) |
| duration 10505분 뻥튀기 | `SELECT duration_minutes` | ✅ npm id6=10505, 로컬 전부 NULL |
| better-sqlite3 ^12.6.2 vs 12.11.1 | `npm view @1.13.2` + 로컬 설치본 | ✅ npm dep=^12.6.2, 로컬=12.11.1, Node26 ABI 147 |
| catch 에러 로깅 | `logHookError` 소스 + debug.log | ✅ 로컬 line 945-946 존재 |
| 영어 에러 추출 동등 | fx3(EN) 양쪽 저장 | ✅ 둘 다 TypeError 저장 |

**핵심 오염 증거 (last_work):**

| id | fixture | npm v1.13.2 저장값 | 로컬 v1.15.0 저장값 |
|---|---|---|---|
| 1 | fx1 KR slash | `- 프로젝트 작업 메인 명령어 (v2)` ← 커맨드 문서 제목 | `결제 모듈 버그 수정하고 테스트 추가해줘` ← 실제 요청 |
| 2 | fx2 EN slash | `- clone a web app` ← 커맨드 문서 제목 | `Fix the checkout flow and add unit tests for the payment service` |
| 3-6 | 나머지 | 동일 | 동일 |

fx1 fixture 원본: `<command-args>결제 모듈 버그 수정하고 테스트 추가해줘</command-args>` 가 실제 사용자 요청.
npm은 이걸 버리고 `# /work - 프로젝트 작업 메인 명령어 (v2)`(isMeta 커맨드 문서 본문)를 last_work로 저장.
→ **다음 세션이 "무슨 작업이었나"를 물으면 npm은 커맨드 이름만 알려주고 실제 작업 내용은 유실.**

출처: `ws_npm/.claude/sessions.db`, `ws_local/.claude/sessions.db`, `fixtures/fx1_slash_command_kr.jsonl`, `fixtures/fx2_slash_command_en.jsonl`

---

## 1. 평가 차원 정의 및 배점

"세션 연속성 보장"은 **저장이 실제로 일어나고(생존) → 저장된 내용이 정확하고(신호) → 쓰레기가 안 섞이고(노이즈) → 중복 폭증이 없고(중복) → 필드가 거짓말을 안 하고(신뢰성) → 언어 무관하고(다국어) → 실패해도 진단 가능한가(관찰가능성)** 로 구성된다.

배점은 연속성에 대한 **인과적 중요도** 순으로 가중:

| # | 차원 | 배점 | 가중 근거 |
|---|---|---:|---|
| A | 안정성/생존성 | 25 | **연속성의 대전제.** 훅이 죽으면 저장 0 → 연속성 0. 나머지 차원은 저장이 성공해야 의미. |
| B | last_work 정확도 | 20 | 연속성의 1차 산출물. 다음 세션이 읽는 핵심 필드. |
| C | 노이즈 억제 | 15 | 저장돼도 쓰레기면 재개 시 오도(誤導). |
| D | 데이터 신뢰성 | 15 | 거짓 필드값(duration)은 "그럴듯한 오답"이라 무필드보다 나쁠 수 있음. |
| E | 다국어 지원 | 10 | KR+EN 실사용 환경. |
| F | 중복 억제 | 10 | 중복은 노이즈보다 회복 가능(정렬/최신 1건만 읽으면 됨)하나 DB 비대·재개 혼란 유발. |
| G | 관찰가능성 | 5 | 연속성 자체는 아니나 회귀 발생 시 진단 속도를 좌우. |
| | **합계** | **100** | |

---

## 2. 차원별 점수

### A. 안정성/생존성 — 배점 25

| | 점수 | 근거 |
|---|---:|---|
| npm v1.13.2 | **8 / 25** | dep `better-sqlite3 ^12.6.2`. 12.6.2 prebuilt는 Node 26(ABI 147, 로컬 `process.versions.modules=147`) 이전 빌드 → 네이티브 바인딩 로드 실패. 실측 이력상 이 ABI 불일치로 **18일간 write-stop**(훅이 조용히 실패, DB에 아무것도 안 쌓임). 정상 Node 버전에선 동작하므로 완전 0은 아님. 그러나 "훅이 안 죽는다"는 대전제가 환경 의존적으로 깨졌으므로 대폭 감점. 출처: `npm view claude-session-continuity-mcp@1.13.2 dependencies.better-sqlite3` = `^12.6.2`. |
| 로컬 v1.15.0 | **24 / 25** | `better-sqlite3 12.11.1` — Node 26 ABI 147과 호환. 벤치 7 fixture 전부 정상 write(sessions 6행 + solutions 2행). 1점 감점 = 페어 INSERT 레이스(§5)가 "쓰기 자체"의 원자성을 완전 보장하진 않음. 출처: 설치본 `require('better-sqlite3/package.json').version` = `12.11.1`, `ws_local` DB 정상 채워짐. |

### B. last_work 정확도 — 배점 20

| | 점수 | 근거 |
|---|---:|---|
| npm v1.13.2 | **10 / 20** | 6건 중 2건(fx1, fx2 = slash 커맨드 경로)에서 실제 사용자 요청 대신 **커맨드 문서 제목**을 저장 → 33% 오염. `<command-args>` 내용 삭제. 나머지 4건(일반 발화)은 정확. 출처: `SELECT last_work FROM sessions WHERE id IN (1,2)` = `- 프로젝트 작업 메인 명령어 (v2)`, `- clone a web app`. |
| 로컬 v1.15.0 | **20 / 20** | 6/6 정확. slash 케이스에서 `stripSlashPrefix` + command-args 추출로 실제 요청 저장. 오염 0. 출처: `ws_local` id1=`결제 모듈 버그 수정하고 테스트 추가해줘`, id2=`Fix the checkout flow...`. |

### C. 노이즈 억제 — 배점 15

| | 점수 | 근거 |
|---|---:|---|
| npm v1.13.2 | **7 / 15** | solutions 4건 중 2건이 노이즈. id1 SIG=`버그 수정하고 테스트 추가해줘</command-args>`(에러 아님, 커맨드 요청 파편 + 닫는 태그 잔존), id4 SIG=`문제 있으면 말씀해 주세요 다음 진행할게요`(정중한 마무리 멘트, 에러 아님). last_work 오염(§B)까지 합치면 노이즈 유입 경로가 둘. 진짜 에러 2건은 정상 저장돼 절반은 건짐. 출처: `SELECT error_signature FROM solutions` (ws_npm). |
| 로컬 v1.15.0 | **15 / 15** | solutions 정확히 2건, 둘 다 진짜 에러(`TypeError cannot read property map`, `빌드 실패 메모리 초과`). fx5(noise-not-error)는 저장 안 됨. 소스의 `hasErrorSignal` 게이트(line 845-848)가 라틴 문자 없고 에러 표현(`실패|오류|초과|...`) 없는 순수 한국어 파편(`문제 있으면...`)을 거부. 출처: `SELECT error_signature FROM solutions` (ws_local) 2행, `session-end.ts:845-848`. |

### D. 데이터 신뢰성 — 배점 15

| | 점수 | 근거 |
|---|---:|---|
| npm v1.13.2 | **6 / 15** | `duration_minutes`를 transcript first↔last 타임스탬프 차로 계산 → fx7(7/01→7/08 resume 세션)에서 **10505분(7.3일)** 저장. resume/continue 시 벽시계 경과를 "세션 길이"로 오기록하는 거짓값. 다른 필드(project/timestamp)는 정상이라 0은 아님. 출처: `SELECT duration_minutes FROM sessions WHERE id=6` = `10505`, `fixtures/fx7` (09:00 07-01 → 16:05 07-08). |
| 로컬 v1.15.0 | **14 / 15** | duration INSERT 폐기, 전 행 NULL(`session-end.ts:795-798`). 거짓값 대신 "값 없음" → 소비처가 오판할 여지 제거(코드 전체에 이 필드 읽는 곳 없음도 확인). 만점 아닌 이유: 폐기는 "정직한 회피"지 "정확한 세션 길이 산출"은 아님. 필드가 살아있으나 항상 빈 상태. 출처: `SELECT duration_minutes FROM sessions WHERE duration_minutes IS NOT NULL` = 0행. |

### E. 다국어 지원 (KR+EN) — 배점 10

| | 점수 | 근거 |
|---|---:|---|
| npm v1.13.2 | **9 / 10** | 에러 추출은 KR/EN 둘 다 됨(fx3 EN TypeError, fx3 KR 빌드실패 모두 저장). 감점 1 = slash 오염(§B)이 KR/EN 양쪽에서 동일하게 발생(fx1 KR, fx2 EN 둘 다 제목 저장) → 언어와 무관한 결함이지만 "다국어 입력을 정확히 처리"라는 관점에선 양 언어 모두 실패. |
| 로컬 v1.15.0 | **10 / 10** | KR/EN 대칭. 에러 추출 게이트가 라틴 문자면 통과, 순수 한국어는 에러 표현 화이트리스트로 통과(line 845-847) → 양 언어 진짜 에러만 저장. slash 추출도 양 언어 정확. 출처: solutions에 EN·KR 에러 각 1건, last_work에 EN·KR 요청 각 정확. |

### F. 중복 억제 — 배점 10

| | 점수 | 근거 |
|---|---:|---|
| npm v1.13.2 | **5 / 10** | 벤치 fixture엔 24h 내 중복이 없어 두 버전 저장 행수는 동일(중복 억제 차이가 이 fixture에선 발현 안 됨 — **동등 구간**). 그러나 프로덕션 실 DB에서 `/mcp-dev` 클러스터 60건 반복이 관측된 이력(소스 주석 line 768)이 npm 시절 축적분 → 과거 억제 부실을 반영해 중간. |
| 로컬 v1.15.0 | **7 / 10** | 3단계 dedup(exact 24h / URL 정규화 24h / Jaccard≥0.85 24h, line 737-785). 다만 **Jaccard 0.85는 near-dup을 못 잡음**(§5) → 만점 불가. 벤치에선 npm과 저장 행수 동일하나, 억제 로직 자체는 명확히 강함. |

*주: 이 차원은 벤치 fixture로는 두 버전 결과가 갈리지 않는다. 점수차는 소스 로직 + 프로덕션 이력에 근거하며, fixture 단독 증거가 아님을 명시한다.*

### G. 관찰가능성 — 배점 5

| | 점수 | 근거 |
|---|---:|---|
| npm v1.13.2 | **1 / 5** | catch 블록이 에러를 조용히 삼킴(로깅 없음). §A의 18일 write-stop이 오래 방치된 것도 실패가 안 보였기 때문. |
| 로컬 v1.15.0 | **5 / 5** | 최상위 catch에서 `logHookError('session-end', e)`(line 945-946) + `session-end-debug.log`에 매 실행 기록(fixture 7회 전부 기록됨). 실패 시 흔적 남김. 출처: `utils/logger.ts:153-168`, `ws_local/.claude/session-end-debug.log`. |

---

## 3. 총점

| 차원 | 배점 | npm v1.13.2 | 로컬 v1.15.0 |
|---|---:|---:|---:|
| A 안정성/생존성 | 25 | 8 | 24 |
| B last_work 정확도 | 20 | 10 | 20 |
| C 노이즈 억제 | 15 | 7 | 15 |
| D 데이터 신뢰성 | 15 | 6 | 14 |
| E 다국어 | 10 | 9 | 10 |
| F 중복 억제 | 10 | 5 | 7 |
| G 관찰가능성 | 5 | 1 | 5 |
| **총점** | **100** | **46** | **95** |

**격차: +49점 (46 → 95).**

---

## 4. 결론

### 로컬이 세션 연속성을 "확실히 더 잘" 보장하는가 → **YES**

정량 근거:
1. **생존성 (가장 중요, 25점):** npm은 Node 26에서 better-sqlite3 ABI 불일치로 훅이 죽어 **18일간 저장 0**. 저장이 0이면 다른 모든 차원은 무의미하다. 로컬은 12.11.1로 정상 동작. 이 한 항목만으로도 연속성의 대전제가 갈린다. (8 vs 24)
2. **정확도 (20점):** slash 커맨드 세션에서 npm은 사용자 요청의 33%(2/6)를 커맨드 문서 제목으로 대체 유실. 로컬 0% 오염. (10 vs 20)
3. **신호 대 잡음:** npm solutions 50%가 노이즈(2/4), duration은 7.3일 거짓값. 로컬은 진짜 에러만 2건 + duration NULL. (C+D: 13 vs 29)

3회 RALF 재현에서 동일 결과 + 내 독립 SELECT 재검증 일치 → 결과는 결정적(deterministic)이고 재현 가능.

### 동등한 부분 (정직하게)

- **영어 에러 추출:** 양쪽 동일하게 fx3 EN TypeError 저장. 다국어 "에러 추출" 축은 npm도 약하지 않음(9/10).
- **일반(non-slash) last_work:** fx3~fx6 4건은 npm도 정확히 저장. 오염은 slash 경로에 국한.
- **중복 억제 (벤치 한정):** 이 7 fixture엔 24h 내 중복이 없어 저장 행수가 두 버전 동일 → 이 데이터셋만으로는 중복 차원의 우열을 증명 못 함. F 점수차는 소스 로직·프로덕션 이력 근거이지 fixture 증거가 아님.

---

## 5. 로컬의 잔존 약점 / 미해결 (감점 사유)

로컬이 완벽하지 않다. 아래는 실측 확인된 결함:

### 5-1. 페어 INSERT 잔존 — 동일 세션 2행 중복 저장 (F, A 감점)

프로덕션 DB(읽기 전용)에서 확인:

```
id   last_work(55자)                              timestamp
897  이거 멀티에이전트랑 전문가 기반 평가지 이용해서...   2026-07-08 05:32:40
898  이거 멀티에이전트랑 전문가 기반 평가지 이용해서...   2026-07-08 05:32:40   ← 897과 동일 내용+동일 타임스탬프
899  이거 멀티에이전트랑 전문가 기반 평가지 이용해서...   2026-07-08 05:53:44   ← 21분 뒤 또 반복
```

출처: `SELECT id, last_work, timestamp FROM sessions WHERE id BETWEEN 895 AND 900` (프로덕션 DB, SELECT only).

- **원인:** 두 훅 인스턴스가 같은 SessionEnd에 동시 발화 → 각자의 dedup SELECT가 상대의 INSERT를 보기 전에 둘 다 write(TOCTOU 레이스). timestamp가 초 단위까지 동일한 게 증거.
- **왜 dedup이 못 막나:** exact-match dedup은 `timestamp > -24h` 조건으로 조회하는데, 두 INSERT가 사실상 동시라 서로를 못 본다. UNIQUE 제약이나 파일락 직렬화가 없다.
- **영향:** 재개 시 같은 내용이 2~3번 뜸(치명적이진 않으나 DB 비대 + 혼란). A를 만점 안 준 이유이기도 함.

### 5-2. Jaccard 0.85가 near-dup(0.6~0.8)을 못 잡음 (F 감점)

실제 `jaccardSimilarity`(session-end.ts:462) 구현으로 재현 측정:

| 사실상 같은 작업의 두 표현 | Jaccard | 0.85 통과? |
|---|---:|---|
| `세션 연속성 개선사항 리스트업 해줘` / `세션 연속성 개선사항 정리해줘` | 0.500 | ❌ 둘 다 저장됨 |
| `결제 모듈 버그 수정하고 테스트 추가` / `결제 모듈 버그 수정 및 유닛 테스트 작성` | 0.444 | ❌ |
| `Fix the checkout flow and add tests` / `Fix checkout flow, write unit tests` | 0.444 | ❌ |

출처: 실 구현 복제 후 `node` 실행.

- **문제:** 임계값 0.85는 near-verbatim(거의 글자 그대로)만 잡는다. 의미가 동일하나 어미·조사·동의어만 바뀐 재표현(0.4~0.8)은 전부 별개 세션으로 저장 → 중복 억제가 "완전 동일 문장"에만 작동.
- **트레이드오프:** 소스 주석(line 770)은 0.85가 높아 "진짜 다른 작업"을 안 지운다고 설명 — 즉 **false-positive(진짜 새 작업을 중복으로 오삭제)를 피하려 일부러 보수적**으로 잡은 값. 방향은 옳으나(연속성에선 삭제 오류가 더 위험) near-dup은 통과하는 명백한 갭.

### 5-3. duration 폐기는 회피지 해결 아님 (D 감점)

거짓값을 없앤 건 옳지만 "세션 길이"를 정확히 산출하진 못한다. 필드가 스키마에 살아있으나 항상 NULL — 향후 소비처가 생기면 다시 설계 필요.

---

## 부록: 검증에 사용한 출처

- 벤치 DB: `ws_npm/.claude/sessions.db`, `ws_local/.claude/sessions.db` (SELECT)
- fixture: `fixtures/fx1_slash_command_kr.jsonl` ~ `fx7_resume_multiday.jsonl`
- 소스: `src/hooks/session-end.ts` (line 462 Jaccard, 712-720 stripSlashPrefix, 737-785 dedup, 795-810 duration폐기+INSERT, 845-864 solutions 게이트, 945-946 logHookError), `src/utils/logger.ts:153-168`
- 버전: `package.json`(로컬 1.15.0, better-sqlite3 ^12.11.1), `npm view @1.13.2`(better-sqlite3 ^12.6.2), `node -p process.versions.modules`(147)
- 프로덕션 DB(읽기 전용): `/Users/ibyeongchang/.../.claude/sessions.db` — 페어 INSERT id 897/898/899 확인만
