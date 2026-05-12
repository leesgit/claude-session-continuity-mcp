#!/usr/bin/env bash
# claude-session-continuity-mcp 가치 측정 스크립트
# 사용: bash scripts/measure.sh
# 출력: 베이스라인 대비 sessions/memories/solutions/duration 변화 + 자동 추출 효과

set -euo pipefail

DB="${MCP_DB:-/Users/ibyeongchang/Documents/dev/ai-service-generator/.claude/sessions.db}"

if [ ! -f "$DB" ]; then
  echo "ERROR: DB not found at $DB" >&2
  exit 1
fi

echo "==================================================================="
echo "  claude-session-continuity-mcp 가치 측정 — $(date '+%Y-%m-%d %H:%M:%S')"
echo "  DB: $DB"
echo "==================================================================="

# === 핵심 카운트 ===
echo ""
echo "## 핵심 카운트"
sqlite3 -column -header "$DB" "
SELECT
  (SELECT COUNT(*) FROM sessions) AS sessions,
  (SELECT COUNT(*) FROM memories) AS memories,
  (SELECT COUNT(*) FROM solutions) AS solutions,
  ROUND(1.0 * (SELECT COUNT(*) FROM sessions) / NULLIF((SELECT COUNT(*) FROM memories), 0), 1) AS s_m_ratio;
"

# === duration_minutes 충실도 (Phase 1 P0-4) ===
echo ""
echo "## duration_minutes 수집 충실도 (Phase 1 효과)"
sqlite3 -column -header "$DB" "
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN duration_minutes IS NOT NULL THEN 1 ELSE 0 END) AS with_duration,
  ROUND(100.0 * SUM(CASE WHEN duration_minutes IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct
FROM sessions;
"

# === auto-extracted 메모리 (Phase 2 효과) ===
echo ""
echo "## auto-extracted 메모리 (Phase 2 효과)"
sqlite3 -column -header "$DB" "
SELECT memory_type, COUNT(*) cnt, ROUND(AVG(importance),1) avg_imp
FROM memories
WHERE tags LIKE '%auto-extracted%'
GROUP BY memory_type;
"

# === 최근 24h 활동 ===
echo ""
echo "## 최근 24h 활동"
sqlite3 -column -header "$DB" "
SELECT
  (SELECT COUNT(*) FROM sessions WHERE timestamp > datetime('now','-1 day')) AS sessions_24h,
  (SELECT COUNT(*) FROM memories WHERE created_at > datetime('now','-1 day')) AS memories_24h,
  (SELECT COUNT(*) FROM solutions WHERE created_at > datetime('now','-1 day')) AS solutions_24h;
"

# === memory_type 분포 ===
echo ""
echo "## memory_type 분포"
sqlite3 -column -header "$DB" "
SELECT memory_type, COUNT(*) cnt
FROM memories GROUP BY memory_type ORDER BY cnt DESC;
"

# === 베이스라인 비교 (2026-05-12 Phase 2 직후) ===
echo ""
echo "## 베이스라인 (2026-05-12 Phase 2 직후) 대비"
sqlite3 -column -header "$DB" "
WITH baseline AS (
  SELECT 1291 AS b_sessions, 61 AS b_memories, 58 AS b_solutions, 4 AS b_duration
), curr AS (
  SELECT
    (SELECT COUNT(*) FROM sessions) c_sessions,
    (SELECT COUNT(*) FROM memories) c_memories,
    (SELECT COUNT(*) FROM solutions) c_solutions,
    (SELECT SUM(CASE WHEN duration_minutes IS NOT NULL THEN 1 ELSE 0 END) FROM sessions) c_duration
)
SELECT
  c.c_sessions - b.b_sessions AS delta_sessions,
  c.c_memories - b.b_memories AS delta_memories,
  c.c_solutions - b.b_solutions AS delta_solutions,
  c.c_duration - b.b_duration AS delta_duration
FROM baseline b, curr c;
"

# === 가치 점수 추정 ===
echo ""
echo "## 가치 점수 추정 (0-100)"
sqlite3 "$DB" "
WITH stats AS (
  SELECT
    (SELECT COUNT(*) FROM sessions) AS s,
    (SELECT COUNT(*) FROM memories) AS m,
    (SELECT COUNT(*) FROM solutions) AS sol,
    (SELECT 100.0 * SUM(CASE WHEN duration_minutes IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) FROM sessions) AS dur_pct,
    (SELECT COUNT(*) FROM memories WHERE tags LIKE '%auto-extracted%') AS auto_mem
)
SELECT
  CAST(
    CASE WHEN m > 0 AND s/m <= 5 THEN 20 ELSE CAST(20.0 * 5 / MAX(1.0*s/m, 5) AS INT) END +  -- memories 비율
    CASE WHEN dur_pct >= 50 THEN 10 ELSE CAST(dur_pct/5 AS INT) END +                         -- duration 충실도
    CASE WHEN sol >= 70 THEN 15 ELSE CAST(15.0 * sol / 70 AS INT) END +                       -- solutions
    CASE WHEN auto_mem >= 20 THEN 25 ELSE CAST(25.0 * auto_mem / 20 AS INT) END +             -- 자동 추출
    30  -- SESSION.md 수동 연속성 (이미 잘 작동)
  AS INT) AS score
FROM stats;
"

echo ""
echo "==================================================================="
echo "  베이스라인 (2026-05-12):"
echo "    sessions=1291, memories=61, solutions=58, with_duration=4"
echo "    가치 점수: ~38/100 (Phase 0) → 예상 75/100 (Phase 2 효과 누적 시)"
echo "==================================================================="
