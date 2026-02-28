#!/usr/bin/env node
/**
 * PreCompact Hook - 컨텍스트 압축 전 중요 메모리 저장
 *
 * 컨텍스트가 압축되기 전에 현재 세션의 중요 정보를 메모리에 저장합니다.
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

interface CompactInput {
  cwd?: string;
  sessionId?: string;
  transcript?: Array<{
    role: string;
    content: string;
  }>;
}

function detectWorkspaceRoot(cwd: string): string {
  let current = cwd;
  const root = path.parse(current).root;

  while (current !== root) {
    if (fs.existsSync(path.join(current, 'apps'))) return current;
    if (fs.existsSync(path.join(current, '.claude', 'sessions.db'))) return current;
    current = path.dirname(current);
  }

  return cwd;
}

function getDbPath(cwd: string): string {
  const workspaceRoot = detectWorkspaceRoot(cwd);
  const claudeDir = path.join(workspaceRoot, '.claude');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  return path.join(claudeDir, 'sessions.db');
}

function detectProject(cwd: string): string {
  const workspaceRoot = detectWorkspaceRoot(cwd);
  const appsDir = path.join(workspaceRoot, 'apps');

  // apps/ 하위인지 확인
  if (cwd.startsWith(appsDir + path.sep)) {
    const relative = path.relative(appsDir, cwd);
    return relative.split(path.sep)[0];
  }

  // apps/ 외부 하위 프로젝트 (hackathons/ 등)
  if (cwd !== workspaceRoot) {
    let current = cwd;
    while (current !== workspaceRoot && current !== path.parse(current).root) {
      const pkgPath = path.join(current, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          return pkg.name || path.basename(current);
        } catch {
          return path.basename(current);
        }
      }
      current = path.dirname(current);
    }
  }

  // 워크스페이스 루트 → 폴더명 반환
  return path.basename(workspaceRoot);
}

function extractKeyPoints(transcript: Array<{ role: string; content: string }>): string[] {
  const keyPoints: string[] = [];

  // 최근 메시지에서 중요 패턴 추출
  const recentMessages = transcript.slice(-20);

  for (const msg of recentMessages) {
    if (msg.role !== 'assistant') continue;
    const content = msg.content;

    // 결정 사항 패턴
    const decisionPatterns = [
      /(?:decided|결정|선택)[^.]*\./gi,
      /(?:will use|사용할)[^.]*\./gi,
      /(?:approach|방식)[^.]*\./gi,
    ];

    for (const pattern of decisionPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        keyPoints.push(...matches.slice(0, 2));
      }
    }

    // 에러 해결 패턴
    const errorPatterns = [
      /(?:fixed|수정|해결)[^.]*(?:error|bug|issue|오류|버그)[^.]*\./gi,
      /(?:error|bug|issue|오류|버그)[^.]*(?:fixed|수정|해결)[^.]*\./gi,
    ];

    for (const pattern of errorPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        keyPoints.push(...matches.slice(0, 2));
      }
    }
  }

  // 중복 제거 및 길이 제한
  const unique = [...new Set(keyPoints)].slice(0, 5);
  return unique.map(p => p.slice(0, 200));
}

async function main() {
  try {
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input: CompactInput = inputData ? JSON.parse(inputData) : {};
    const cwd = input.cwd || process.cwd();
    const project = detectProject(cwd);
    const dbPath = getDbPath(cwd);

    if (!fs.existsSync(dbPath)) {
      process.stdout.write(JSON.stringify({ continue: true }));
      process.exit(0);
    }

    const db = new Database(dbPath);

    // transcript에서 핵심 포인트 추출
    const keyPoints = input.transcript ? extractKeyPoints(input.transcript) : [];

    if (keyPoints.length > 0) {
      // 중요 메모리로 저장
      db.prepare(`
        INSERT INTO memories (content, memory_type, project, importance, tags)
        VALUES (?, 'pattern', ?, 8, '["auto-compact","session-summary"]')
      `).run(`[Pre-Compact Summary] ${keyPoints.join(' | ')}`, project);

      // 활성 컨텍스트 업데이트
      db.prepare(`
        INSERT OR REPLACE INTO active_context (project, current_state, updated_at)
        VALUES (?, ?, datetime('now'))
      `).run(project, `Compacted: ${keyPoints[0]?.slice(0, 50) || 'Session context saved'}`);
    }

    // === 컨텍스트 재주입: systemMessage로 반환 ===
    const recoveryLines: string[] = [`# ${project} - Recovered Context\n`];

    // 사용자 지시사항 (HIGH 우선)
    try {
      const directives = db.prepare(`
        SELECT directive, priority FROM user_directives
        WHERE project = ? ORDER BY priority DESC, created_at DESC LIMIT 10
      `).all(project) as Array<{ directive: string; priority: string }>;

      if (directives.length > 0) {
        recoveryLines.push('## DIRECTIVES (MUST FOLLOW)');
        for (const d of directives) {
          const prefix = d.priority === 'high' ? '🔴 CRITICAL' : '📎';
          recoveryLines.push(`- ${prefix}: ${d.directive}`);
        }
        recoveryLines.push('');
      }
    } catch { /* table may not exist */ }

    // 기술 스택
    const fixed = db.prepare('SELECT tech_stack FROM project_context WHERE project = ?').get(project) as { tech_stack: string } | undefined;
    if (fixed?.tech_stack) {
      try {
        const stack = JSON.parse(fixed.tech_stack);
        recoveryLines.push(`**Stack**: ${Object.entries(stack).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
      } catch { /* ignore */ }
    }

    // 현재 상태
    const active = db.prepare('SELECT current_state, blockers FROM active_context WHERE project = ?').get(project) as { current_state: string; blockers: string } | undefined;
    if (active?.current_state) {
      recoveryLines.push(`**State**: ${active.current_state}`);
      if (active.blockers) recoveryLines.push(`**Blocker**: ${active.blockers}`);
    }

    // Hot paths (상위 5개)
    try {
      const hotPaths = db.prepare(`
        SELECT file_path, access_count FROM hot_paths
        WHERE project = ? AND last_accessed > datetime('now', '-7 days')
        ORDER BY access_count DESC LIMIT 5
      `).all(project) as Array<{ file_path: string; access_count: number }>;

      if (hotPaths.length > 0) {
        recoveryLines.push(`**Hot Files**: ${hotPaths.map(h => h.file_path.split('/').pop()).join(', ')}`);
      }
    } catch { /* table may not exist */ }

    // Key points from this session
    if (keyPoints.length > 0) {
      recoveryLines.push(`\n## Session Key Points`);
      for (const kp of keyPoints) {
        recoveryLines.push(`- ${kp}`);
      }
    }

    db.close();

    // systemMessage로 반환 → 컴팩션 후에도 유지
    const output = {
      continue: true,
      systemMessage: recoveryLines.join('\n')
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (e) {
    // 에러 시 조용히 종료
    process.exit(0);
  }
}

main();
