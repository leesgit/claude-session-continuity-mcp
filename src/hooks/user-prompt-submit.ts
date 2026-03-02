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

  // 워크스페이스 루트 (모노레포 포함) → 폴더명 반환
  return path.basename(workspaceRoot);
}

// ===== 과거 참조 자동 감지 =====

const PAST_REFERENCE_PATTERNS: RegExp[] = [
  // 한국어
  /(?:저번에|전에|이전에|그때|지난번에|예전에|아까)\s+(.+?)(?:\s*(?:어떻게|뭐|무엇|왜|어디|언제))/,
  /(?:했던|했었던|만들었던|수정했던|구현했던|해결했던)\s*(.+)/,
  /(?:지난|이전|전)\s*(?:세션|작업|시간|번).*?(?:에서|때)\s*(.+)/,
  // 영어
  /(?:last time|before|previously|earlier)\s+(?:.*?)\s*((?:how|what|why|where|when).*)/i,
  /(?:did we|did I|have we|have I)\s+(.+)\s+(?:before|last time|earlier)/i,
  /(?:remember when|recall when)\s+(.+)/i,
];

function extractPastKeywords(prompt: string): string | null {
  for (const pattern of PAST_REFERENCE_PATTERNS) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      // 추출된 키워드에서 조사/의문사 제거, 핵심 단어만
      return match[1].trim().replace(/[?？\s]+$/g, '').slice(0, 50);
    }
  }
  return null;
}

interface PastWorkResult {
  sessions: Array<{ date: string; work: string }>;
  memories: Array<{ type: string; content: string }>;
  solutions: Array<{ signature: string; solution: string }>;
}

function searchPastWork(db: Database.Database, keyword: string): PastWorkResult {
  const result: PastWorkResult = { sessions: [], memories: [], solutions: [] };
  const likeKeyword = `%${keyword}%`;

  // 1. sessions 검색 (최근 30일, 상위 3건)
  try {
    const sessions = db.prepare(`
      SELECT last_work, timestamp FROM sessions
      WHERE last_work LIKE ?
        AND last_work != 'Session ended'
        AND last_work != 'Session work completed'
        AND last_work != 'Session started'
        AND last_work != ''
        AND timestamp > datetime('now', '-30 days')
      ORDER BY timestamp DESC LIMIT 3
    `).all(likeKeyword) as Array<{ last_work: string; timestamp: string }>;

    for (const s of sessions) {
      const work = s.last_work.length > 80 ? s.last_work.slice(0, 80) + '...' : s.last_work;
      result.sessions.push({ date: s.timestamp?.slice(0, 10) || 'unknown', work });
    }
  } catch { /* ignore */ }

  // 2. memories FTS5 검색 (상위 2건)
  try {
    const memories = db.prepare(`
      SELECT m.content, m.memory_type FROM memories m
      JOIN memories_fts fts ON m.id = fts.rowid
      WHERE memories_fts MATCH ?
      ORDER BY rank LIMIT 2
    `).all(keyword) as Array<{ content: string; memory_type: string }>;

    for (const m of memories) {
      const content = m.content.length > 80 ? m.content.slice(0, 80) + '...' : m.content;
      result.memories.push({ type: m.memory_type, content });
    }
  } catch {
    // FTS5 매칭 실패 시 LIKE 폴백
    try {
      const memories = db.prepare(`
        SELECT content, memory_type FROM memories
        WHERE content LIKE ?
        ORDER BY importance DESC, created_at DESC LIMIT 2
      `).all(likeKeyword) as Array<{ content: string; memory_type: string }>;

      for (const m of memories) {
        const content = m.content.length > 80 ? m.content.slice(0, 80) + '...' : m.content;
        result.memories.push({ type: m.memory_type, content });
      }
    } catch { /* ignore */ }
  }

  // 3. solutions 검색 (상위 2건)
  try {
    const solutions = db.prepare(`
      SELECT error_signature, solution FROM solutions
      WHERE error_signature LIKE ? OR solution LIKE ?
      ORDER BY created_at DESC LIMIT 2
    `).all(likeKeyword, likeKeyword) as Array<{ error_signature: string; solution: string }>;

    for (const s of solutions) {
      const sol = s.solution.length > 80 ? s.solution.slice(0, 80) + '...' : s.solution;
      result.solutions.push({ signature: s.error_signature, solution: sol });
    }
  } catch { /* ignore */ }

  return result;
}

function formatPastWork(pastWork: PastWorkResult): string | null {
  const { sessions, memories, solutions } = pastWork;
  if (sessions.length === 0 && memories.length === 0 && solutions.length === 0) return null;

  const lines: string[] = ['## Related Past Work (auto-detected from your question)\n'];

  if (sessions.length > 0) {
    lines.push('### Sessions');
    for (const s of sessions) {
      lines.push(`- [${s.date}] ${s.work}`);
    }
    lines.push('');
  }

  if (memories.length > 0) {
    const typeIcons: Record<string, string> = {
      observation: '👀', decision: '🎯', learning: '📚', error: '⚠️', pattern: '🔄'
    };
    lines.push('### Memories');
    for (const m of memories) {
      const icon = typeIcons[m.type] || '💭';
      lines.push(`- ${icon} [${m.type}] ${m.content}`);
    }
    lines.push('');
  }

  if (solutions.length > 0) {
    lines.push('### Solutions');
    for (const s of solutions) {
      lines.push(`- **${s.signature}**: ${s.solution}`);
    }
    lines.push('');
  }

  return lines.join('\n');
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

async function main() {
  // 환경 변수로 비활성화 가능
  if (process.env.MCP_HOOKS_DISABLED === 'true') {
    process.exit(0);
  }

  try {
    // stdin에서 입력 읽기
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input: PromptInput = inputData ? JSON.parse(inputData) : {};
    const cwd = input.cwd || process.cwd();
    const workspaceRoot = detectWorkspaceRoot(cwd);
    const project = getProject(cwd, workspaceRoot);

    if (!project) {
      process.exit(0);
    }

    const dbPath = path.join(workspaceRoot, '.claude', 'sessions.db');

    // 사용자 프롬프트에서 지시사항 추출 (DB 저장, 출력 0 토큰)
    if (input.prompt) {
      extractAndSaveDirectives(dbPath, project, input.prompt);
    }

    // 과거 참조 감지 시에만 출력 (~200 토큰)
    if (input.prompt && fs.existsSync(dbPath)) {
      const keyword = extractPastKeywords(input.prompt);
      if (keyword) {
        try {
          const db = new Database(dbPath, { readonly: true });
          const pastWork = searchPastWork(db, keyword);
          const pastSection = formatPastWork(pastWork);
          db.close();
          if (pastSection) {
            console.log(`\n<past-context project="${project}">\n${pastSection}\n</past-context>\n`);
          }
        } catch { /* ignore */ }
      }
    }

    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
}

main();
