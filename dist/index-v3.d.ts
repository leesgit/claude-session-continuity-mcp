#!/usr/bin/env node
/**
 * Project Manager MCP v3
 *
 * 18개 도구로 리팩토링된 버전
 * - mcp-memory-service 스타일 채택
 * - Hook 자동 주입 + 도구 최소화
 *
 * 카테고리:
 * 1. 세션/컨텍스트 (4개): session_start, session_end, session_history, search_sessions
 * 2. 프로젝트 관리 (4개): project_status, project_init, project_analyze, list_projects
 * 3. 태스크/백로그 (4개): task_add, task_update, task_list, task_suggest
 * 4. 솔루션 아카이브 (3개): solution_record, solution_find, solution_suggest
 * 5. 검증/품질 (3개): verify_build, verify_test, verify_all
 */
export {};
