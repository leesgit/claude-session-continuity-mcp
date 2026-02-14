#!/usr/bin/env node
/**
 * UserPromptSubmit Hook - 매 프롬프트마다 관련 컨텍스트 자동 주입
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

interface PromptInput {
  prompt?: string;
  cwd?: string;
}

function detectWorkspaceRoot(cwd: string): string {
  let current = cwd;
  const root = path.parse(current).root;

  while (current !== root) {
    if (fs.existsSync(path.join(current, 'apps'))) return current;
    if (fs.existsSync(path.join(current, '.claude', 'sessions.db'))) return current;
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    current = path.dirname(current);
  }

  return cwd;
}

function getProject(cwd: string, workspaceRoot: string): string | null {
  const appsDir = path.join(workspaceRoot, 'apps');

  if (cwd.startsWith(appsDir + path.sep)) {
    const relative = path.relative(appsDir, cwd);
    return relative.split(path.sep)[0];
  }

  if (!fs.existsSync(appsDir)) {
    return path.basename(workspaceRoot);
  }

  return null;
}

// ===== 사용자 지시사항 자동 추출 =====

const DIRECTIVE_PATTERNS: Array<{ pattern: RegExp; priority: 'high' | 'normal' }> = [
  { pattern: /(?:절대|never)\s+(.+)/i, priority: 'high' },
  { pattern: /(?:항상|always)\s+(.+)/i, priority: 'high' },
  { pattern: /(?:반드시|must)\s+(.+)/i, priority: 'high' },
  { pattern: /never\s+(?:use|modify|touch)\s+(.+)/i, priority: 'high' },
  { pattern: /always\s+(?:use|check|include)\s+(.+)/i, priority: 'high' },
  { pattern: /#(?:기억|remember)\s+(.+)/i, priority: 'normal' },
  { pattern: /(?:important|중요)[:\s]+(.+)/i, priority: 'normal' },
  { pattern: /(?:rule|규칙)[:\s]+(.+)/i, priority: 'normal' },
];

const MAX_DIRECTIVES = 20;

function extractAndSaveDirectives(dbPath: string, project: string, prompt: string): void {
  try {
    const db = new Database(dbPath);

    for (const { pattern, priority } of DIRECTIVE_PATTERNS) {
      const match = prompt.match(pattern);
      if (match && match[1]) {
        const directive = match[1].trim().slice(0, 200);
        if (directive.length < 5) continue;

        // UPSERT directive
        db.prepare(`
          INSERT INTO user_directives (project, directive, context, source, priority)
          VALUES (?, ?, ?, 'explicit', ?)
          ON CONFLICT(project, directive) DO UPDATE SET
            priority = ?,
            created_at = CURRENT_TIMESTAMP
        `).run(project, directive, prompt.slice(0, 300), priority, priority);
      }
    }

    // MAX_DIRECTIVES 초과 시 가장 오래된 normal 삭제
    const count = (db.prepare('SELECT COUNT(*) as cnt FROM user_directives WHERE project = ?').get(project) as { cnt: number })?.cnt || 0;
    if (count > MAX_DIRECTIVES) {
      db.prepare(`
        DELETE FROM user_directives WHERE id IN (
          SELECT id FROM user_directives
          WHERE project = ? AND priority = 'normal'
          ORDER BY created_at ASC
          LIMIT ?
        )
      `).run(project, count - MAX_DIRECTIVES);
    }

    db.close();
  } catch {
    // 테이블 미존재 등 무시
  }
}

function loadContext(dbPath: string, project: string): string | null {
  if (!fs.existsSync(dbPath)) return null;

  try {
    const db = new Database(dbPath, { readonly: true });

    const lines: string[] = [`# 🚀 ${project} Context\n`];

    // 기술 스택
    const fixed = db.prepare('SELECT tech_stack FROM project_context WHERE project = ?').get(project) as { tech_stack: string } | undefined;
    if (fixed?.tech_stack) {
      const stack = JSON.parse(fixed.tech_stack);
      const stackStr = Object.entries(stack).map(([k, v]) => `**${k}**: ${v}`).join(', ');
      lines.push(`## Tech Stack\n${stackStr}\n`);
    }

    // 현재 상태
    const active = db.prepare('SELECT current_state, blockers, last_verification FROM active_context WHERE project = ?').get(project) as { current_state: string; blockers: string; last_verification: string } | undefined;
    if (active?.current_state) {
      lines.push(`## Current State`);
      lines.push(`📍 ${active.current_state}`);
      if (active.blockers) lines.push(`🚧 **Blocker**: ${active.blockers}`);
      if (active.last_verification) {
        const emoji = active.last_verification.includes('passed') ? '✅' : '❌';
        lines.push(`${emoji} Last verify: ${active.last_verification}`);
      }
      lines.push('');
    }

    // 마지막 세션 (빈 세션 skip)
    const last = db.prepare(`
      SELECT last_work, next_tasks, timestamp FROM sessions
      WHERE project = ?
        AND last_work != 'Session ended'
        AND last_work != 'Session work completed'
        AND last_work != 'Session started'
        AND last_work != ''
      ORDER BY timestamp DESC LIMIT 1
    `).get(project) as { last_work: string; next_tasks: string; timestamp: string } | undefined;
    if (last?.last_work) {
      lines.push(`## Last Session (${last.timestamp?.slice(0, 10) || 'unknown'})`);
      lines.push(`**Work**: ${last.last_work}`);
      if (last.next_tasks) {
        const next = JSON.parse(last.next_tasks);
        if (next.length > 0) lines.push(`**Next**: ${next.slice(0, 3).join(' → ')}`);
      }
      lines.push('');
    }

    // 사용자 지시사항
    try {
      const directives = db.prepare(`
        SELECT directive, priority FROM user_directives
        WHERE project = ? ORDER BY priority DESC, created_at DESC LIMIT 10
      `).all(project) as Array<{ directive: string; priority: string }>;

      if (directives.length > 0) {
        lines.push('## 📌 Directives');
        for (const d of directives) {
          const icon = d.priority === 'high' ? '🔴' : '📎';
          lines.push(`- ${icon} ${d.directive}`);
        }
        lines.push('');
      }
    } catch { /* table may not exist yet */ }

    // 미완료 태스크
    const tasks = db.prepare(`
      SELECT id, title, priority, status FROM tasks
      WHERE project = ? AND status IN ('pending', 'in_progress')
      ORDER BY priority DESC LIMIT 5
    `).all(project) as Array<{ id: number; title: string; priority: number; status: string }>;

    if (tasks.length > 0) {
      lines.push('## 📋 Pending Tasks');
      for (const t of tasks) {
        const icon = t.status === 'in_progress' ? '🔄' : '⏳';
        lines.push(`- ${icon} [P${t.priority}] ${t.title} (#${t.id})`);
      }
      lines.push('');
    }

    // 중요 메모리
    const memories = db.prepare(`
      SELECT content, memory_type, importance FROM memories
      WHERE project = ?
      ORDER BY importance DESC, created_at DESC LIMIT 5
    `).all(project) as Array<{ content: string; memory_type: string; importance: number }>;

    if (memories.length > 0) {
      const typeIcons: Record<string, string> = {
        observation: '👀', decision: '🎯', learning: '📚', error: '⚠️', pattern: '🔄'
      };
      lines.push('## 🧠 Key Memories');
      for (const m of memories) {
        const icon = typeIcons[m.memory_type] || '💭';
        const content = m.content.length > 100 ? m.content.slice(0, 100) + '...' : m.content;
        lines.push(`- ${icon} [${m.memory_type}] ${content}`);
      }
      lines.push('');
    }

    // 최근 에러 솔루션
    const solutions = db.prepare(`
      SELECT error_signature, solution FROM solutions
      WHERE project = ?
      ORDER BY created_at DESC LIMIT 3
    `).all(project) as Array<{ error_signature: string; solution: string }>;

    if (solutions.length > 0) {
      lines.push('## 🔧 Recent Error Solutions');
      for (const s of solutions) {
        const sol = s.solution.length > 80 ? s.solution.slice(0, 80) + '...' : s.solution;
        lines.push(`- **${s.error_signature}**: ${sol}`);
      }
      lines.push('');
    }

    db.close();

    lines.push('---');
    lines.push('_Auto-injected by MCP v5. Use `session_end` when done._');

    return lines.join('\n');
  } catch (e) {
    return null;
  }
}

async function main() {
  // 환경 변수로 비활성화 가능
  if (process.env.MCP_HOOKS_DISABLED === 'true') {
    process.exit(0);
  }

  try {
    // stdin에서 입력 읽기 (타임아웃 방지)
    let inputData = '';
    const timeout = setTimeout(() => {
      // 입력 없으면 그냥 진행
    }, 100);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      inputData += chunk;
    });

    await new Promise<void>((resolve) => {
      process.stdin.on('end', () => {
        clearTimeout(timeout);
        resolve();
      });
      // 100ms 후 타임아웃
      setTimeout(resolve, 100);
    });

    const cwd = process.cwd();
    const workspaceRoot = detectWorkspaceRoot(cwd);
    const project = getProject(cwd, workspaceRoot);

    if (!project) {
      process.exit(0);
    }

    const dbPath = path.join(workspaceRoot, '.claude', 'sessions.db');

    // 사용자 프롬프트에서 지시사항 추출
    if (inputData) {
      try {
        const parsed = JSON.parse(inputData) as PromptInput;
        if (parsed.prompt) {
          extractAndSaveDirectives(dbPath, project, parsed.prompt);
        }
      } catch { /* ignore */ }
    }

    const context = loadContext(dbPath, project);

    if (context) {
      console.log(`\n<project-context project="${project}">\n${context}\n</project-context>\n`);
    }

    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
}

main();
