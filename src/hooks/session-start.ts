#!/usr/bin/env node
/**
 * SessionStart Hook - 세션 시작 시 컨텍스트 자동 주입
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

interface SessionInput {
  cwd?: string;
  sessionId?: string;
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

function getProject(cwd: string, workspaceRoot: string): string | null {
  const appsDir = path.join(workspaceRoot, 'apps');

  // apps/ 하위인지 확인
  if (cwd.startsWith(appsDir + path.sep)) {
    const relative = path.relative(appsDir, cwd);
    return relative.split(path.sep)[0];
  }

  // 워크스페이스 루트 자체에서 실행
  if (cwd === workspaceRoot) {
    // 모노레포(apps/ 있음)에서 루트 실행 → 프로젝트 없음
    if (fs.existsSync(appsDir)) {
      return null;
    }
    // 단일 프로젝트 모드 → package.json 이름 또는 폴더명
    const pkgPath = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.name || path.basename(workspaceRoot);
      } catch {
        return path.basename(workspaceRoot);
      }
    }
    return path.basename(workspaceRoot);
  }

  // apps/ 외부 하위 프로젝트 (hackathons/ 등) - package.json에서 이름 추출
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

  return null;
}

function loadContext(dbPath: string, project: string): string | null {
  if (!fs.existsSync(dbPath)) return null;

  try {
    const db = new Database(dbPath, { readonly: true });

    const lines: string[] = [`# ${project} - Session Resumed\n`];

    // 기술 스택
    const fixed = db.prepare('SELECT tech_stack FROM project_context WHERE project = ?').get(project) as { tech_stack: string } | undefined;
    if (fixed?.tech_stack) {
      const stack = JSON.parse(fixed.tech_stack);
      const stackStr = Object.entries(stack).map(([k, v]) => `**${k}**: ${v}`).join(', ');
      lines.push(`## Tech Stack\n${stackStr}\n`);
    }

    // 현재 상태
    const active = db.prepare('SELECT current_state, blockers FROM active_context WHERE project = ?').get(project) as { current_state: string; blockers: string } | undefined;
    if (active?.current_state) {
      lines.push(`## Current State\n📍 ${active.current_state}`);
      if (active.blockers) lines.push(`🚧 **Blocker**: ${active.blockers}`);
      lines.push('');
    }

    // 마지막 세션
    const last = db.prepare('SELECT last_work, next_tasks, timestamp FROM sessions WHERE project = ? ORDER BY timestamp DESC LIMIT 1').get(project) as { last_work: string; next_tasks: string; timestamp: string } | undefined;
    if (last?.last_work) {
      lines.push(`## Last Session (${last.timestamp?.slice(0, 10) || 'unknown'})`);
      lines.push(`**Work**: ${last.last_work}`);
      if (last.next_tasks) {
        const next = JSON.parse(last.next_tasks);
        if (next.length > 0) lines.push(`**Next**: ${next.slice(0, 3).join(' → ')}`);
      }
      lines.push('');
    }

    // 미완료 태스크
    const tasks = db.prepare(`
      SELECT title, priority, status FROM tasks
      WHERE project = ? AND status IN ('pending', 'in_progress')
      ORDER BY priority DESC LIMIT 5
    `).all(project) as Array<{ title: string; priority: number; status: string }>;

    if (tasks.length > 0) {
      lines.push('## 📋 Pending Tasks');
      for (const t of tasks) {
        const icon = t.status === 'in_progress' ? '🔄' : '⏳';
        lines.push(`- ${icon} [P${t.priority}] ${t.title}`);
      }
      lines.push('');
    }

    // 중요 메모리
    const memories = db.prepare(`
      SELECT content, memory_type FROM memories
      WHERE project = ?
      ORDER BY importance DESC, created_at DESC LIMIT 5
    `).all(project) as Array<{ content: string; memory_type: string }>;

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

    db.close();

    lines.push('---');
    lines.push('_Auto-injected by session-continuity. Use `session_end` when done._');

    return lines.join('\n');
  } catch (e) {
    return null;
  }
}

async function main() {
  try {
    // stdin에서 입력 읽기
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input: SessionInput = inputData ? JSON.parse(inputData) : {};
    const cwd = input.cwd || process.cwd();

    const workspaceRoot = detectWorkspaceRoot(cwd);
    const project = getProject(cwd, workspaceRoot);

    if (!project) {
      process.exit(0);
    }

    const dbPath = path.join(workspaceRoot, '.claude', 'sessions.db');
    const context = loadContext(dbPath, project);

    if (context) {
      console.log(`\n<session-context project="${project}">\n${context}\n</session-context>\n`);
    } else {
      console.log(`\n[Session] Project: ${project} (no context yet)\n`);
    }

    process.exit(0);
  } catch (e) {
    // 에러 시 조용히 종료
    process.exit(0);
  }
}

main();
