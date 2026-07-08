#!/bin/bash
# 연속성 벤치: npm v1.13.2 vs 로컬 v1.15.0을 동일 fixture로 돌려 비교
set -uo pipefail

SP=/private/tmp/claude-501/-Users-ibyeongchang-Documents-dev-ai-service-generator/3989e265-664f-4821-90ec-46f749b7ca4e/scratchpad
BENCH=$SP/continuity_bench
FIX=$BENCH/fixtures
NPM_HOOK=$SP/npm_compare/package/dist/hooks/session-end.js
LOCAL_DIR=~/Documents/dev/ai-service-generator/tools/project-manager-mcp
LOCAL_HOOK=$LOCAL_DIR/dist/hooks/session-end.js
NP=$LOCAL_DIR/node_modules

# 두 버전 각각 격리 workspace + 빈 DB에서 실행
run_version() {
  local label=$1 hook=$2 node_path=$3
  local ws=$BENCH/ws_$label
  rm -rf "$ws"; mkdir -p "$ws/.claude"
  # 빈 sessions.db를 로컬 스키마로 초기화 (실제 DB에서 스키마만 복사)
  sqlite3 "$ws/.claude/sessions.db" ".schema" < /dev/null 2>/dev/null
  sqlite3 ~/Documents/dev/ai-service-generator/.claude/sessions.db ".schema sessions" | sqlite3 "$ws/.claude/sessions.db"
  sqlite3 ~/Documents/dev/ai-service-generator/.claude/sessions.db ".schema solutions" | sqlite3 "$ws/.claude/sessions.db" 2>/dev/null
  sqlite3 ~/Documents/dev/ai-service-generator/.claude/sessions.db ".schema active_context" | sqlite3 "$ws/.claude/sessions.db" 2>/dev/null

  local i=0
  for fx in "$FIX"/*.jsonl; do
    i=$((i+1))
    echo "{\"session_id\":\"bench-$label-$i\",\"transcript_path\":\"$fx\",\"cwd\":\"$ws\",\"hook_event_name\":\"Stop\",\"stop_hook_active\":false}" \
      | NODE_PATH=$node_path node "$hook" >/dev/null 2>>"$ws/errors.log"
  done
  echo "$ws"
}

echo "=== npm v1.13.2 실행 ==="
WS_NPM=$(run_version "npm" "$NPM_HOOK" "$NP")
echo "=== 로컬 v1.15.0 실행 ==="
WS_LOCAL=$(run_version "local" "$LOCAL_HOOK" "$NP")

echo ""
echo "############ 결과 비교 ############"
compare() {
  local ws=$1 label=$2
  local db="$ws/.claude/sessions.db"
  echo "----- $label -----"
  echo "sessions 저장 수: $(sqlite3 "$db" 'SELECT COUNT(*) FROM sessions;' 2>/dev/null)"
  echo "solutions 저장 수: $(sqlite3 "$db" 'SELECT COUNT(*) FROM solutions;' 2>/dev/null)"
  echo "오염 last_work (- 또는 — 시작): $(sqlite3 "$db" "SELECT COUNT(*) FROM sessions WHERE last_work LIKE '- %' OR last_work LIKE '— %' OR last_work LIKE '#%';" 2>/dev/null)"
  echo "hook 실행 에러: $(wc -l < "$ws/errors.log" 2>/dev/null | tr -d ' ')"
  echo "duration NULL: $(sqlite3 "$db" "SELECT SUM(CASE WHEN duration_minutes IS NULL THEN 1 ELSE 0 END) FROM sessions;" 2>/dev/null) / $(sqlite3 "$db" "SELECT COUNT(*) FROM sessions;" 2>/dev/null)"
  echo "저장된 last_work 목록:"
  sqlite3 "$db" "SELECT '  ['||id||'] '||substr(last_work,1,60) FROM sessions ORDER BY id;" 2>/dev/null
  echo "저장된 solutions error_signature:"
  sqlite3 "$db" "SELECT '  - '||substr(error_signature,1,50) FROM solutions ORDER BY id;" 2>/dev/null
}
compare "$WS_NPM" "npm v1.13.2"
echo ""
compare "$WS_LOCAL" "로컬 v1.15.0"
