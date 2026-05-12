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

  // apps/ 외부 하위 프로젝트 (hackathons/ 등) - package.json에서 이름 추출
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

  // 워크스페이스 루트 (모노레포 포함) → 폴더명 반환
  return path.basename(workspaceRoot);
}

function cleanupNoiseMemories(db: InstanceType<typeof Database>): void {
  try {
    // 3일+ auto-tracked 관찰 메모리 삭제
    db.prepare(`
      DELETE FROM memories
      WHERE memory_type = 'observation'
        AND tags LIKE '%auto-tracked%'
        AND created_at < datetime('now', '-3 days')
    `).run();

    // 14일+ auto-compact 패턴 메모리 삭제
    db.prepare(`
      DELETE FROM memories
      WHERE tags LIKE '%auto-compact%'
        AND created_at < datetime('now', '-14 days')
    `).run();
  } catch { /* ignore */ }
}

// 토큰 예산 시스템 (컨텍스트 무한 증가 방지)
const MAX_CONTEXT_TOKENS = parseInt(process.env.MCP_CONTEXT_BUDGET || '2000', 10);
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4); // 대략적 추정 (한글은 1.5~2배)
}

function loadContext(dbPath: string, project: string): string | null {
  if (!fs.existsSync(dbPath)) return null;

  try {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL'); // 다중 hook 프로세스 동시성 보장

    // 노이즈 메모리 자동 정리
    cleanupNoiseMemories(db);

    const lines: string[] = [`# ${project} - Session Resumed\n`];
    let tokenBudget = MAX_CONTEXT_TOKENS;

    // [Priority 1] 현재 상태
    const active = db.prepare('SELECT current_state, blockers FROM active_context WHERE project = ?').get(project) as { current_state: string; blockers: string } | undefined;
    if (active?.current_state) {
      const stateBlock = `📍 **State**: ${active.current_state}` + (active.blockers ? `\n🚧 **Blocker**: ${active.blockers}` : '');
      const cost = estimateTokens(stateBlock);
      if (tokenBudget > cost) {
        lines.push(stateBlock);
        lines.push('');
        tokenBudget -= cost;
      }
    }

    // [Priority 2] 최근 3개 세션 (빈 세션 skip)
    const recentSessions = db.prepare(`
      SELECT last_work, next_tasks, issues, timestamp FROM sessions
      WHERE project = ?
        AND last_work != 'Session ended'
        AND last_work != 'Session work completed'
        AND last_work != 'Session started'
        AND last_work != ''
        AND length(last_work) > 15
      ORDER BY timestamp DESC LIMIT 3
    `).all(project) as Array<{
      last_work: string; next_tasks: string; issues: string; timestamp: string
    }>;

    if (recentSessions.length > 0 && tokenBudget > 100) {
      const sessionLines: string[] = ['## Recent Sessions'];
      for (const session of recentSessions) {
        const work = session.last_work.length > 60 ? session.last_work.slice(0, 60) + '...' : session.last_work;
        sessionLines.push(`- [${session.timestamp?.slice(0, 10) || '?'}] ${work}`);

        if (session.issues) {
          try {
            const meta = JSON.parse(session.issues);
            if (meta.commits?.length > 0) {
              sessionLines.push(`  commits: ${meta.commits.slice(0, 2).join('; ').slice(0, 80)}`);
            }
          } catch { /* skip */ }
        }
      }
      const cost = estimateTokens(sessionLines.join('\n'));
      if (tokenBudget > cost) {
        lines.push(...sessionLines, '');
        tokenBudget -= cost;
      }
    }

    // [Priority 3] 사용자 지시사항 (가장 중요 - 예산 부족해도 high priority는 포함)
    try {
      const directives = db.prepare(`
        SELECT directive, priority FROM user_directives
        WHERE project = ? ORDER BY priority DESC, created_at DESC LIMIT 5
      `).all(project) as Array<{ directive: string; priority: string }>;

      if (directives.length > 0) {
        const directiveLines = ['## Directives'];
        for (const d of directives) {
          const icon = d.priority === 'high' ? '🔴' : '📎';
          directiveLines.push(`- ${icon} ${d.directive}`);
        }
        const cost = estimateTokens(directiveLines.join('\n'));
        // 지시사항은 예산 초과해도 high priority는 포함
        const highOnly = directives.filter(d => d.priority === 'high');
        if (tokenBudget > cost) {
          lines.push(...directiveLines, '');
          tokenBudget -= cost;
        } else if (highOnly.length > 0) {
          const criticalLines = ['## Directives'];
          for (const d of highOnly) criticalLines.push(`- 🔴 ${d.directive}`);
          lines.push(...criticalLines, '');
          tokenBudget -= estimateTokens(criticalLines.join('\n'));
        }
      }
    } catch { /* table may not exist yet */ }

    // [Priority 4] 미완료 태스크
    if (tokenBudget > 50) {
      try {
        const tasks = db.prepare(`
          SELECT title, priority, status FROM tasks
          WHERE project = ? AND status IN ('pending', 'in_progress')
          ORDER BY priority DESC LIMIT 5
        `).all(project) as Array<{ title: string; priority: number; status: string }>;

        if (tasks.length > 0) {
          const taskLines = ['## Pending Tasks'];
          for (const t of tasks) {
            const icon = t.status === 'in_progress' ? '🔄' : '⏳';
            taskLines.push(`- ${icon} [P${t.priority}] ${t.title}`);
          }
          const cost = estimateTokens(taskLines.join('\n'));
          if (tokenBudget > cost) {
            lines.push(...taskLines, '');
            tokenBudget -= cost;
          }
        }
      } catch { /* table may not exist */ }
    }

    // [Priority 5] 중요 메모리 (temporal decay 적용, 예산 내에서)
    if (tokenBudget > 80) try {
      const memories = db.prepare(`
        SELECT content, memory_type, importance, created_at, access_count FROM memories
        WHERE project = ?
          AND memory_type IN ('decision', 'learning', 'error', 'preference')
          AND importance >= 3
          AND (tags NOT LIKE '%auto-tracked%' OR tags IS NULL)
          AND (tags NOT LIKE '%auto-compact%' OR tags IS NULL)
        ORDER BY importance DESC, accessed_at DESC LIMIT 20
      `).all(project) as Array<{ content: string; memory_type: string; importance: number; created_at: string; access_count: number }>;

      if (memories.length > 0) {
        // Decay 적용 후 top 5 선택
        const DECAY_RATES: Record<string, number> = {
          decision: 0.001, learning: 0.003, error: 0.01, preference: 0.002
        };
        const scored = memories.map(m => {
          const ageDays = (Date.now() - new Date(m.created_at).getTime()) / (1000 * 60 * 60 * 24);
          const decayRate = DECAY_RATES[m.memory_type] ?? 0.005;
          const score = m.importance * Math.exp(-decayRate * ageDays) * Math.log2(m.access_count + 2);
          return { ...m, score };
        }).sort((a, b) => b.score - a.score).slice(0, 5);

        const typeIcons: Record<string, string> = {
          decision: '🎯', learning: '📚', error: '⚠️', preference: '💡'
        };
        const memoryLines = ['## Key Memories'];
        for (const m of scored) {
          const icon = typeIcons[m.memory_type] || '💭';
          const content = m.content.length > 80 ? m.content.slice(0, 80) + '...' : m.content;
          memoryLines.push(`- ${icon} ${content}`);
        }
        const cost = estimateTokens(memoryLines.join('\n'));
        if (tokenBudget > cost) {
          lines.push(...memoryLines, '');
          tokenBudget -= cost;
        }
      }
    } catch { /* ignore */ }

    // [Priority 6] 솔루션 통계 (1줄, 저비용)
    try {
      const solCount = (db.prepare(
        'SELECT COUNT(*) as cnt FROM solutions WHERE project = ?'
      ).get(project) as { cnt: number })?.cnt || 0;
      if (solCount > 0) {
        const solLine = `\nSolutions: ${solCount} recorded (auto-injected on error)\n`;
        if (tokenBudget > 10) {
          lines.push(solLine);
          tokenBudget -= estimateTokens(solLine);
        }
      }
    } catch { /* solutions table may not exist */ }

    db.close();

    lines.push('---');
    lines.push('_Auto-injected by session-continuity v2. Use `session_end` when done._');

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
