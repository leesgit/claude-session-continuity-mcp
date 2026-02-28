#!/usr/bin/env node
/**
 * SessionEnd Hook (Stop 이벤트) - 세션 종료 시 자동 저장
 *
 * Claude Code 세션 종료 시 자동으로 컨텍스트를 저장합니다.
 *
 * Stop 이벤트 입력 필드:
 * - session_id, cwd, permission_mode, hook_event_name, stop_hook_active
 * - transcript_path: JSONL 파일 경로 (전체 대화 기록)
 * - last_assistant_message: 마지막 assistant 메시지 텍스트
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import Database from 'better-sqlite3';

interface SessionEndInput {
  cwd?: string;
  session_id?: string;
  transcript_path?: string;
  last_assistant_message?: string;
  // 레거시: 이전 버전 호환
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

  if (cwd.startsWith(appsDir + path.sep)) {
    const relative = path.relative(appsDir, cwd);
    return relative.split(path.sep)[0];
  }

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

  return path.basename(workspaceRoot);
}

/**
 * 마크다운 문법 제거 — 순수 텍스트로 변환
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold** → bold
    .replace(/\*(.+?)\*/g, '$1')        // *italic* → italic
    .replace(/`([^`]+)`/g, '$1')        // `code` → code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [link](url) → link
    .replace(/#{1,6}\s*/g, '')           // ## heading → heading
    .trim();
}

/**
 * 텍스트 행이 "노이즈"인지 판별
 */
function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 15) return true;               // 너무 짧음
  if (trimmed.startsWith('|')) return true;             // 마크다운 테이블 행
  if (trimmed.startsWith('```')) return true;           // 코드 블록 경계
  if (trimmed.startsWith('---')) return true;           // 구분선
  if (/^[-*+]\s*$/.test(trimmed)) return true;          // 빈 리스트
  if (/^#+\s*$/.test(trimmed)) return true;             // 빈 헤딩
  if (/^\s*```/.test(trimmed)) return true;             // 들여쓴 코드 블록
  if (/^(Sources?|참고|Note|주의)[:\s]/i.test(trimmed)) return true; // 메타 텍스트
  return false;
}

/**
 * 단일 텍스트(last_assistant_message 등)에서 의미있는 요약 추출
 *
 * 우선순위:
 * 1. 구조화 마커 <!--SESSION:{"done":"..."}-->
 * 2. 완료 문장 패턴 (I've completed..., 구현 완료 등)
 * 3. 첫 의미있는 단락 (테이블/코드블록/리스트 제외)
 */
function extractSummaryFromText(content: string): string {
  if (!content || content.length < 10) return '';

  // 전처리: 테이블 행, 코드블록 제거 → 순수 텍스트
  const cleanedContent = content
    .replace(/```[\s\S]*?```/g, '')              // 코드블록 제거
    .split('\n')
    .filter(line => !line.trim().startsWith('|') && !line.trim().startsWith('---'))
    .join('\n');

  // 전략 1: 구조화 마커 (CLAUDE.md 규칙을 따르는 경우)
  const markerMatch = content.match(/<!--SESSION:(.*?)-->/s);
  if (markerMatch?.[1]) {
    try {
      const parsed = JSON.parse(markerMatch[1]);
      if (parsed.done && parsed.done.length > 5) return stripMarkdown(parsed.done).slice(0, 200);
    } catch { /* malformed JSON, fall through */ }
  }

  // 전략 2: 완료/성과 문장 추출 (정제된 텍스트에서)
  const completionMatch = cleanedContent.match(
    /(?:I've |I have |Successfully |completed |finished |implemented |fixed |created |added |updated |refactored |deployed |배포 완료|구현 완료|작업 완료|수정 완료|테스트 통과|빌드 성공)([^.!?\n]{5,150}[.!?]?)/i
  );
  if (completionMatch) {
    const sentence = stripMarkdown(completionMatch[0]).trim();
    if (sentence.length > 15) return sentence.slice(0, 200);
  }

  // 전략 3: ✅ 마커 뒤 텍스트 (정제된 텍스트에서)
  const checkMatch = cleanedContent.match(/✅\s*(.+)/);
  if (checkMatch?.[1]) {
    const cleaned = stripMarkdown(checkMatch[1]).trim();
    if (cleaned.length > 10) return cleaned.slice(0, 200);
  }

  // 전략 4: 첫 헤딩 제목 (## 제목) — 짧아도 허용 (성과 요약인 경우 많음)
  const headingMatch = cleanedContent.match(/^#{1,3}\s+(.+)$/m);
  if (headingMatch?.[1]) {
    const title = stripMarkdown(headingMatch[1]).trim();
    if (title.length > 5) return title.slice(0, 200);
  }

  // 전략 5: 첫 의미있는 단락 (노이즈 라인 건너뜀)
  const lines = cleanedContent.split('\n');
  for (const line of lines) {
    if (isNoiseLine(line)) continue;
    const cleaned = stripMarkdown(line).trim();
    if (cleaned.length > 20) return cleaned.slice(0, 200);
  }

  return '';
}

/**
 * transcript_path (JSONL)에서 마지막 N개의 assistant 메시지 읽기
 * 전체 파일을 메모리에 올리지 않고 스트림으로 처리
 */
async function readRecentAssistantMessages(transcriptPath: string, maxMessages = 5): Promise<string[]> {
  if (!fs.existsSync(transcriptPath)) return [];

  const messages: string[] = [];

  try {
    const fileStream = fs.createReadStream(transcriptPath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'assistant' || entry.role === 'assistant') {
          // JSONL 형식에 따라 content 추출
          const content = typeof entry.message?.content === 'string'
            ? entry.message.content
            : Array.isArray(entry.message?.content)
              ? entry.message.content
                .filter((b: { type: string }) => b.type === 'text')
                .map((b: { text: string }) => b.text)
                .join('\n')
              : '';
          if (content.length > 10) {
            messages.push(content);
          }
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* file read error */ }

  // 마지막 N개만 반환
  return messages.slice(-maxMessages);
}

/**
 * 다음 할 일 추출 (텍스트에서)
 * 테이블 행, 코드블록 내부는 제외
 */
function extractNextTasks(content: string): string[] {
  const nextTasks: string[] = [];

  // 코드블록과 테이블 행 제거
  const cleaned = content
    .replace(/```[\s\S]*?```/g, '')              // 코드블록 제거
    .split('\n')
    .filter(line => !line.trim().startsWith('|')) // 테이블 행 제거
    .join('\n');

  const nextPatterns = [
    /(?:next steps?|todo|remaining|다음 (?:단계|작업|할 일)|남은 작업|해야 할)[:\s]*([^.!?\n]{10,})/gi,
  ];

  for (const pattern of nextPatterns) {
    let match;
    while ((match = pattern.exec(cleaned)) !== null) {
      if (match[1]) {
        const task = stripMarkdown(match[1]).trim().slice(0, 100);
        if (task.length > 10) nextTasks.push(task);
      }
    }
  }

  return nextTasks;
}

async function main() {
  try {
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input: SessionEndInput = inputData ? JSON.parse(inputData) : {};
    const cwd = input.cwd || process.cwd();
    const project = detectProject(cwd);
    const dbPath = getDbPath(cwd);

    // 디버그 로그
    const debugLogPath = path.join(path.dirname(dbPath), 'session-end-debug.log');
    const inputKeys = Object.keys(input);
    const lastMsgLen = input.last_assistant_message?.length || 0;
    const debugLine = `[${new Date().toISOString()}] project=${project} keys=[${inputKeys.join(',')}] transcript_path=${input.transcript_path || 'none'} last_msg_len=${lastMsgLen}\n`;
    fs.appendFileSync(debugLogPath, debugLine);

    if (!fs.existsSync(dbPath)) {
      console.log('[SessionEnd] No DB found, skipping');
      process.exit(0);
    }

    const db = new Database(dbPath);

    // === last_work 추출 ===
    let lastWork = '';
    let nextTasks: string[] = [];

    // 소스 1: last_assistant_message (Stop 이벤트에서 직접 제공)
    if (input.last_assistant_message) {
      lastWork = extractSummaryFromText(input.last_assistant_message);
      nextTasks = extractNextTasks(input.last_assistant_message);
    }

    // 소스 2: transcript_path에서 마지막 assistant 메시지들 읽기 (소스 1 실패 시)
    if (!lastWork && input.transcript_path) {
      const recentMessages = await readRecentAssistantMessages(input.transcript_path);
      for (let i = recentMessages.length - 1; i >= 0; i--) {
        lastWork = extractSummaryFromText(recentMessages[i]);
        if (lastWork) break;
      }
      // next tasks도 마지막 메시지에서 추출
      if (recentMessages.length > 0) {
        nextTasks = extractNextTasks(recentMessages[recentMessages.length - 1]);
      }
    }

    // 소스 3: 레거시 transcript 배열 (이전 버전 호환)
    if (!lastWork && input.transcript) {
      const assistantMsgs = input.transcript.filter(m => m.role === 'assistant');
      if (assistantMsgs.length < 2) {
        console.log(`[SessionEnd] Skipping empty session for ${project}`);
        db.close();
        process.exit(0);
      }
      for (let i = assistantMsgs.length - 1; i >= Math.max(0, assistantMsgs.length - 5); i--) {
        lastWork = extractSummaryFromText(assistantMsgs[i].content);
        if (lastWork) break;
      }
    }

    // === modified_files: active_context에서 PostToolUse가 실시간 저장한 파일 목록 ===
    let modifiedFiles: string[] = [];
    try {
      const activeCtx = db.prepare('SELECT recent_files FROM active_context WHERE project = ?').get(project) as { recent_files: string } | undefined;
      if (activeCtx?.recent_files) {
        modifiedFiles = JSON.parse(activeCtx.recent_files);
      }
    } catch { /* active_context may not exist */ }

    // last_work 폴백: 파일 목록 기반
    if (!lastWork && modifiedFiles.length > 0) {
      const fileNames = modifiedFiles.slice(0, 5).map(f => path.basename(f)).join(', ');
      lastWork = `Modified files: ${fileNames}`;
    }

    // 빈 세션 skip
    if (!lastWork) {
      console.log(`[SessionEnd] Skipping empty session for ${project} (no meaningful last_work)`);
      db.close();
      process.exit(0);
    }

    // 중복 저장 방지: 최근 60초 이내 동일 last_work
    const recentDup = db.prepare(`
      SELECT id FROM sessions
      WHERE project = ? AND last_work = ? AND timestamp > datetime('now', '-60 seconds')
      LIMIT 1
    `).get(project, lastWork);
    if (recentDup) {
      console.log(`[SessionEnd] Skipping duplicate session for ${project}`);
      db.close();
      process.exit(0);
    }

    // 세션 기록 저장
    db.prepare(`
      INSERT INTO sessions (project, last_work, next_tasks, modified_files)
      VALUES (?, ?, ?, ?)
    `).run(
      project,
      lastWork,
      JSON.stringify([...new Set(nextTasks)].slice(0, 5)),
      JSON.stringify(modifiedFiles.slice(0, 15))
    );

    // 활성 컨텍스트 업데이트
    db.prepare(`
      INSERT OR REPLACE INTO active_context (project, current_state, recent_files, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(
      project,
      lastWork,
      JSON.stringify(modifiedFiles.slice(0, 15))
    );

    db.close();

    console.log(`[SessionEnd] Saved session for ${project}`);
    console.log(`  Last work: ${lastWork.slice(0, 80)}`);
    console.log(`  Modified files: ${modifiedFiles.length}`);
    console.log(`  Next tasks: ${nextTasks.length}`);

    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
}

main();
