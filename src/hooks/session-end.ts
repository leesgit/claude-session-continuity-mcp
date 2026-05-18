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
import * as crypto from 'crypto';
import Database from 'better-sqlite3';

interface SessionEndInput {
  cwd?: string;
  session_id?: string;
  transcript_path?: string;
  last_assistant_message?: string;
  // Stop 이벤트가 중첩 호출되는 경우 true (Claude Code 플랫폼 동작)
  stop_hook_active?: boolean;
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

  // 전략 4: 첫 헤딩 제목 — 단, 일반적인 섹션 헤딩은 제외
  const headingMatch = cleanedContent.match(/^#{1,3}\s+(.+)$/m);
  if (headingMatch?.[1]) {
    const title = stripMarkdown(headingMatch[1]).trim();
    // "결과 요약", "평가", "분석" 같은 일반 헤딩은 의미없는 요약이므로 건너뜀
    const genericHeadings = /^(결과|요약|분석|평가|결론|테스트|현재|문제|핵심|다음|참고|MCP|Overview|Summary|Result|Analysis|Test)/i;
    if (title.length > 5 && !genericHeadings.test(title)) return title.slice(0, 200);
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
 * 다음 할 일 추출 (텍스트에서)
 */
function extractNextTasks(content: string): string[] {
  const nextTasks: string[] = [];

  const cleaned = content
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('|'))
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

/**
 * 사용자 메시지를 유효한 요청인지 필터링
 */
function parseUserText(entry: { type?: string; message?: { content?: unknown } }): string {
  const content = entry.message?.content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = (content as Array<{ type: string; text?: string }>)
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n');
  }

  // system-reminder, local-command 태그 제거
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  text = text.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '').trim();
  text = text.replace(/<command-name>[\s\S]*?<\/command-name>/g, '').trim();
  text = text.replace(/<command-message>[\s\S]*?<\/command-message>/g, '').trim();
  text = text.replace(/<command-args>[\s\S]*?<\/command-args>/g, '').trim();
  text = text.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '').trim();
  if (text.length < 5) return '';

  // 시스템/메타 메시지 스킵
  if (text.startsWith('[Request interrupted')) return '';
  if (text.startsWith('This session is being continued')) return '';
  if (text.startsWith('No response requested')) return '';

  return text;
}

/**
 * 메시지 content에서 텍스트 추출 (assistant/human 공통)
 */
function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n');
  }
  return '';
}

interface TranscriptData {
  commitMessages: string[];
  errorsSolved: string[];
  decisions: string[];
  userRequests: { firstRequest: string; allRequests: string[] };
  recentAssistantMessages: string[];
  errorFixPairs: Array<{ error: string; fix: string }>;
  firstTimestamp: string | null; // 세션 시작 시각 (transcript 첫 entry)
  lastTimestamp: string | null;  // 세션 종료 시각 (transcript 마지막 entry)
}

/**
 * Single-Pass Transcript Parser
 * JSONL을 1회 스트림으로 읽으며 모든 데이터를 동시 추출
 */
async function parseTranscriptSinglePass(transcriptPath: string): Promise<TranscriptData> {
  const result: TranscriptData = {
    commitMessages: [],
    errorsSolved: [],
    decisions: [],
    userRequests: { firstRequest: '', allRequests: [] },
    recentAssistantMessages: [],
    errorFixPairs: [],
    firstTimestamp: null,
    lastTimestamp: null,
  };

  if (!transcriptPath || !fs.existsSync(transcriptPath)) return result;

  // commit 추출용 패턴
  const commitPatterns = [
    /git commit.*?-m\s*"\$\(cat <<'?EOF'?\n(.+?)(?:\n\n|\nCo-Authored|\nEOF)/s,
    /git commit.*?-m\s*["']([^"'\n]{10,150})["']/,
  ];

  // decision 추출용 패턴
  const decisionPatterns = [
    /(?:chose|using|switched to|went with)\s+(.{10,80})\s+(?:because|since|instead of|over)/gi,
    /(?:instead of|rather than)\s+(.{10,60})/gi,
    /(.{10,60})(?:으로|로)\s+(?:결정|변경|전환)(?:했|함|합니다)/g,
    /(.{10,60})(?:대신|말고)\s+(.{10,60})(?:사용|적용)/g,
  ];

  // error-fix 추출용
  const recentEntries: Array<{ role: string; text: string }> = [];
  const commitSet = new Set<string>();
  const decisionSet = new Set<string>();

  try {
    const fileStream = fs.createReadStream(transcriptPath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const role = entry.type || entry.role || '';
        const content = entry.message?.content;

        // === 0. Timestamp 추출 (세션 duration 계산용) ===
        if (entry.timestamp) {
          if (!result.firstTimestamp) result.firstTimestamp = entry.timestamp;
          result.lastTimestamp = entry.timestamp;
        }

        // === 1. Commit 추출 (tool_use 블록에서) ===
        if (line.includes('git commit') && Array.isArray(content)) {
          for (const block of content) {
            if (block.type !== 'tool_use') continue;
            const cmd = block.input?.command as string;
            if (!cmd || !cmd.includes('-m')) continue;
            if (!/(?:^|&&\s*)git\s+commit/.test(cmd)) continue;

            for (const pattern of commitPatterns) {
              const match = cmd.match(pattern);
              if (match?.[1]) {
                const msg = match[1].trim().split('\n')[0];
                if (msg.length > 10 && !msg.startsWith('Co-Authored')) {
                  commitSet.add(msg.slice(0, 150));
                }
                break;
              }
            }
          }
        }

        // === 2. User Requests 추출 ===
        if (role === 'human' || role === 'user') {
          const text = parseUserText(entry);
          if (text) {
            const planMatch = text.match(/^Implement the following plan:\s*\n+#\s*(.+)/);
            const cleaned = planMatch
              ? planMatch[1].trim().slice(0, 100)
              : stripMarkdown(text.split('\n')[0].trim()).slice(0, 100);

            if (cleaned && cleaned.length >= 3) {
              if (!result.userRequests.firstRequest) result.userRequests.firstRequest = cleaned;
              result.userRequests.allRequests.push(cleaned);
            }
          }
        }

        // === 3. Assistant 메시지 수집 (decisions + recentMessages) ===
        if (role === 'assistant') {
          const text = extractTextFromContent(content);
          if (text.length > 10) {
            // 최근 10개만 유지 (decision 추출용)
            result.recentAssistantMessages.push(text);
            if (result.recentAssistantMessages.length > 10) {
              result.recentAssistantMessages.shift();
            }
          }
        }

        // === 4. Error-Fix pair용 entries 수집 (최근 30개) ===
        const text = extractTextFromContent(content);
        if (text.length > 5) {
          recentEntries.push({ role, text: text.slice(0, 500) });
          if (recentEntries.length > 30) recentEntries.shift();
        }

      } catch { /* skip malformed lines */ }
    }
  } catch { /* file read error */ }

  // === Post-processing ===

  // Commits
  result.commitMessages = [...commitSet].slice(0, 5);

  // Decisions (최근 assistant 메시지에서)
  for (const msg of result.recentAssistantMessages) {
    for (const pattern of decisionPatterns) {
      pattern.lastIndex = 0;
      const matches = msg.match(pattern);
      if (matches) {
        for (const m of matches.slice(0, 1)) {
          decisionSet.add(stripMarkdown(m).slice(0, 150));
        }
      }
    }
  }
  result.decisions = [...decisionSet].slice(0, 3);

  // Error-Fix pairs (한국어 패턴 보강)
  const errorRe = /(?:error|Error|ERROR|오류|에러|버그|예외|실패|FAILED|Exception|TypeError|ReferenceError|SyntaxError|crash|crashed|충돌|문제)[:\s](.{5,80})/;
  const fixRe = /(?:fixed|resolved|patched|수정|해결|고침|처리|완료|변경|적용|반영|커밋|Added|수정 완료|문제 해결|해결됨|되돌림)/i;
  const pairSet = new Set<string>();

  for (let i = 0; i < recentEntries.length - 1; i++) {
    const errorMatch = recentEntries[i].text.match(errorRe);
    if (errorMatch) {
      for (let j = i + 1; j < Math.min(i + 4, recentEntries.length); j++) {
        if (recentEntries[j].role === 'assistant' && fixRe.test(recentEntries[j].text)) {
          const errorStr = stripMarkdown(errorMatch[0]).slice(0, 80);
          const fixLine = recentEntries[j].text.split('\n').find(l => fixRe.test(l));
          const fixStr = fixLine ? stripMarkdown(fixLine).slice(0, 80) : 'resolved';
          const pairKey = `${errorStr} → ${fixStr}`;
          if (!pairSet.has(pairKey)) {
            pairSet.add(pairKey);
            result.errorFixPairs.push({ error: errorStr, fix: fixStr });
          }
          break;
        }
      }
    }
  }
  result.errorsSolved = [...pairSet].slice(0, 3);

  // recentAssistantMessages → 최근 5개만 유지 (lastWork 폴백용)
  result.recentAssistantMessages = result.recentAssistantMessages.slice(-5);

  return result;
}

/**
 * 슬래시 커맨드 prefix 제거 — "/mcp-dev 측정해줘" → "측정해줘"
 * 첫 토큰이 `/`로 시작하면 다음 의미 토큰까지 스킵
 * 슬래시뿐이면 빈 문자열 반환 (호출자가 폴백 처리)
 */
function stripSlashPrefix(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return trimmed;
  // 첫 줄에서 슬래시 토큰을 제거
  const firstLine = trimmed.split('\n')[0];
  const tokens = firstLine.split(/\s+/);
  let i = 0;
  while (i < tokens.length && tokens[i].startsWith('/')) i++;
  const rest = tokens.slice(i).join(' ').trim();
  if (rest.length >= 3) return rest;
  // 다음 줄에 의미 있는 본문이 있으면 사용
  const lines = trimmed.split('\n').slice(1).map(l => l.trim()).filter(l => l.length >= 3 && !l.startsWith('/'));
  return lines[0] || '';
}

/**
 * Jaccard 유사도 (토큰 단위) — 0~1 사이
 * 동일하면 1, 완전 다르면 0
 */
function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) => new Set(
    s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(t => t.length >= 2)
  );
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersect = 0;
  for (const t of setA) if (setB.has(t)) intersect++;
  const union = setA.size + setB.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

/**
 * 사용자 메시지들을 세션 요약으로 압축
 * 예: ["MCP 테스트해줘", "개선해줘", "npm 배포하고 커밋해줘"] → "MCP 테스트 + 개선 + npm 배포/커밋"
 */
function summarizeUserRequests(requests: string[]): string {
  if (requests.length === 0) return '';

  // 슬래시 커맨드 도움말 본문(/work, /clone-pro 등이 첫 줄에 박히는 케이스) 제외
  // → 36건 동일 last_work 누적 문제 해결
  const meaningful = requests
    .map(r => stripSlashPrefix(r))
    .filter(r => {
      if (!r) return false;
      if (/^[A-Z][a-z]+\s+(skill|command):/i.test(r)) return false;
      return r.length > 0;
    });
  const source = meaningful.length > 0 ? meaningful : requests;

  if (source.length === 1) return source[0];

  // 중복/유사 요청 제거 (앞 20글자 기준)
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const req of source) {
    const key = req.slice(0, 20).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(req);
    }
  }

  // 긴 세션: 첫 요청 + 마지막 2개 요청으로 세션 흐름 표현
  if (unique.length > 5) {
    const first = unique[0];
    const last2 = unique.slice(-2);
    const summary = `${first} ... ${last2.join(' + ')}`;
    return summary.length > 250 ? summary.slice(0, 250) : summary;
  }

  // 짧은 세션: 전부 연결
  const summary = unique.join(' + ');
  return summary.length > 250 ? summary.slice(0, 250) : summary;
}

async function main() {
  try {
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input: SessionEndInput = inputData ? JSON.parse(inputData) : {};

    // 중복 호출 가드 1: stop_hook_active 플래그 (Claude Code 공식 플래그)
    if (input.stop_hook_active === true) {
      process.exit(0);
    }

    const cwd = input.cwd || process.cwd();
    const project = detectProject(cwd);
    const dbPath = getDbPath(cwd);

    // 중복 호출 가드 2: transcript_path 해시 기반 5초 윈도우 파일락
    // Phase 3: session_id 5초 락 도입 (sid 있는 호출만 차단됨)
    // Phase 5: 실측에서 모든 stop이 [sid 있는 호출 + sid 없는 호출] 페어로 들어옴
    //          → transcript_path 해시를 우선 키로 사용해야 같은 페어가 같은 락을 공유
    //          → transcript_path 없을 때만 session_id 폴백
    const lockKey = input.transcript_path
      ? crypto.createHash('md5').update(input.transcript_path).digest('hex').slice(0, 16)
      : (input.session_id || null);
    if (lockKey) {
      const lockPath = path.join(path.dirname(dbPath), `.session-end-${lockKey}.lock`);
      const now = Date.now();
      try {
        // Phase 5: atomic `wx` (존재 시 EEXIST throw) → 두 hook 인스턴스가 거의 동시에 진입하는 race 차단
        // 베이스라인: id=1606/1607이 ~500ms 차이로 동시 INSERT 됨 (debug.log 13:26:51.205 + 13:26:51.702)
        fs.writeFileSync(lockPath, String(now), { flag: 'wx' });
      } catch (e: unknown) {
        // 파일이 이미 존재 (다른 hook 인스턴스가 처리 중) → mtime 확인 후 5초 내면 차단
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
          try {
            const lockMtime = fs.statSync(lockPath).mtimeMs;
            if (now - lockMtime < 5000) {
              process.exit(0); // 5초 내 재발화 차단
            }
            // 5초 지난 stale 락 → 덮어쓰기 (이 호출이 새 작업)
            fs.writeFileSync(lockPath, String(now));
          } catch {
            // stat/write 실패는 fail-soft
          }
        }
        // 그 외 락 파일 에러는 무시 (fail-soft)
      }
    }

    // 디버그 로그
    const debugLogPath = path.join(path.dirname(dbPath), 'session-end-debug.log');
    const inputKeys = Object.keys(input);
    const lastMsgLen = input.last_assistant_message?.length || 0;
    const debugLine = `[${new Date().toISOString()}] project=${project} sid=${input.session_id?.slice(0,8) || 'none'} keys=[${inputKeys.join(',')}] transcript_path=${input.transcript_path || 'none'} last_msg_len=${lastMsgLen}\n`;
    fs.appendFileSync(debugLogPath, debugLine);

    if (!fs.existsSync(dbPath)) {
      console.log('[SessionEnd] No DB found, skipping');
      process.exit(0);
    }

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL'); // 다중 hook 프로세스 동시성 보장

    // === 추출 시작 ===
    let lastWork = '';
    let nextTasks: string[] = [];
    let commitMessages: string[] = [];
    let errorsSolved: string[] = [];
    let decisions: string[] = [];

    // Single-pass transcript 파싱 (1회 스트림)
    let transcript: TranscriptData = {
      commitMessages: [], errorsSolved: [], decisions: [],
      userRequests: { firstRequest: '', allRequests: [] },
      recentAssistantMessages: [],
      errorFixPairs: [],
      firstTimestamp: null,
      lastTimestamp: null,
    };
    if (input.transcript_path) {
      transcript = await parseTranscriptSinglePass(input.transcript_path);
      commitMessages = transcript.commitMessages;
      errorsSolved = transcript.errorsSolved;
      decisions = transcript.decisions;
    }

    // lastWork 결정 (우선순위 폴백)
    const { firstRequest: rawFirstRequest, allRequests } = transcript.userRequests;
    // firstRequest 슬래시 prefix 제거 (예: "/mcp-dev 측정" → "측정")
    const firstRequest = rawFirstRequest ? (stripSlashPrefix(rawFirstRequest) || rawFirstRequest) : '';

    // 2a: 사용자 요청 + 커밋 메시지 조합 (가장 이상적)
    if (firstRequest && commitMessages.length > 0) {
      lastWork = `${firstRequest} → ${commitMessages.slice(0, 2).join('; ')}`;
      if (lastWork.length > 250) lastWork = lastWork.slice(0, 250);
    }
    // 2b: 커밋 메시지만 (사용자 요청 없을 때)
    else if (commitMessages.length > 0) {
      lastWork = commitMessages.slice(0, 3).join('; ');
    }
    // 2c: 사용자 메시지 전체 요약 (커밋 없을 때)
    else if (allRequests.length > 0) {
      lastWork = summarizeUserRequests(allRequests);
    }

    // 2d: last_assistant_message에서 추출
    if (!lastWork && input.last_assistant_message) {
      lastWork = extractSummaryFromText(input.last_assistant_message);
      nextTasks = extractNextTasks(input.last_assistant_message);
    }

    // 2c: transcript에서 최근 assistant 메시지 스캔 (이미 파싱됨)
    if (!lastWork && transcript.recentAssistantMessages.length > 0) {
      for (let i = transcript.recentAssistantMessages.length - 1; i >= 0; i--) {
        lastWork = extractSummaryFromText(transcript.recentAssistantMessages[i]);
        if (lastWork) break;
      }
      if (nextTasks.length === 0) {
        const lastMsg = transcript.recentAssistantMessages[transcript.recentAssistantMessages.length - 1];
        nextTasks = extractNextTasks(lastMsg);
      }
    }

    // 2d: 액션 동사 기반 폴백 (이미 파싱된 메시지에서)
    if (!lastWork && transcript.recentAssistantMessages.length > 0) {
      const actionVerbs = /(?:created|modified|added|removed|fixed|updated|implemented|deployed|configured|refactored|만들|수정|추가|삭제|구현|배포|설정|완료)/i;
      for (const msg of [...transcript.recentAssistantMessages].reverse()) {
        const lines = msg.split('\n').filter(l => !isNoiseLine(l));
        for (const line of lines) {
          if (actionVerbs.test(line) && line.length > 20) {
            const cleaned = stripMarkdown(line).trim();
            if (cleaned.length > 15) { lastWork = cleaned.slice(0, 200); break; }
          }
        }
        if (lastWork) break;
      }
    }

    // 2e: 레거시 transcript 배열
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

    // === modified_files ===
    let modifiedFiles: string[] = [];
    try {
      const activeCtx = db.prepare('SELECT recent_files FROM active_context WHERE project = ?').get(project) as { recent_files: string } | undefined;
      if (activeCtx?.recent_files) {
        modifiedFiles = JSON.parse(activeCtx.recent_files);
      }
    } catch { /* active_context may not exist */ }

    // last_work 최종 폴백: 파일 목록 기반
    if (!lastWork && modifiedFiles.length > 0) {
      const fileNames = modifiedFiles.slice(0, 5).map(f => path.basename(f)).join(', ');
      lastWork = `Modified files: ${fileNames}`;
    }

    // Phase 5: 모든 last_work 결정 경로에 stripSlashPrefix 강제 적용
    // 베이스라인: 2a 경로(firstRequest)만 stripSlashPrefix 적용되고 2c~2e 폴백은 미적용
    //          → 같은 transcript에서 두 hook 인스턴스가 서로 다른 경로로 들어가
    //            한쪽은 "측정", 한쪽은 "/mcp-dev 측정"으로 분기 → Jaccard 0.85 미달로 둘 다 통과
    //          stripSlashPrefix가 빈 문자열을 반환하면 원본 유지 (의미 토큰이 없는 경우)
    if (lastWork) {
      const stripped = stripSlashPrefix(lastWork);
      if (stripped) lastWork = stripped;
    }

    // 빈 세션 skip
    if (!lastWork) {
      console.log(`[SessionEnd] Skipping empty session for ${project} (no meaningful last_work)`);
      db.close();
      process.exit(0);
    }

    // 중복 저장 방지 — Jaccard 유사도 기반 (1시간 이내, 동일 프로젝트)
    // 베이스라인: 동일 last_work가 4~5분 간격으로 반복 INSERT되는 케이스 5건/24h 발견
    // 정확 일치 + Jaccard >= 0.85 둘 다 차단
    const recentExact = db.prepare(`
      SELECT id FROM sessions
      WHERE project = ? AND last_work = ? AND timestamp > datetime('now', '-1 hour')
      LIMIT 1
    `).get(project, lastWork);
    if (recentExact) {
      console.log(`[SessionEnd] Skipping duplicate (exact) for ${project}`);
      db.close();
      process.exit(0);
    }
    const recentRows = db.prepare(`
      SELECT last_work FROM sessions
      WHERE project = ? AND timestamp > datetime('now', '-1 hour')
      ORDER BY timestamp DESC LIMIT 10
    `).all(project) as Array<{ last_work: string }>;
    for (const row of recentRows) {
      if (!row.last_work) continue;
      // Phase 5: 비교 전 양쪽 모두 stripSlashPrefix 정규화 → 표현 차이 흡수
      const normalizedCurrent = stripSlashPrefix(lastWork) || lastWork;
      const normalizedRow = stripSlashPrefix(row.last_work) || row.last_work;
      if (jaccardSimilarity(normalizedCurrent, normalizedRow) >= 0.85) {
        console.log(`[SessionEnd] Skipping near-duplicate (jaccard >= 0.85) for ${project}`);
        db.close();
        process.exit(0);
      }
    }

    // 구조화 메타데이터 (issues 컬럼 활용)
    const metadata = {
      commits: commitMessages,
      decisions,
      errorsSolved
    };
    const hasMetadata = commitMessages.length > 0 || decisions.length > 0 || errorsSolved.length > 0;

    // 세션 duration 계산 (transcript first ↔ last timestamp)
    let durationMinutes: number | null = null;
    if (transcript.firstTimestamp && transcript.lastTimestamp) {
      const start = new Date(transcript.firstTimestamp).getTime();
      const end = new Date(transcript.lastTimestamp).getTime();
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        durationMinutes = Math.round((end - start) / 60000);
      }
    }

    // 세션 기록 저장
    db.prepare(`
      INSERT INTO sessions (project, last_work, next_tasks, modified_files, issues, duration_minutes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      project,
      lastWork,
      JSON.stringify([...new Set(nextTasks)].slice(0, 5)),
      JSON.stringify(modifiedFiles.slice(0, 15)),
      hasMetadata ? JSON.stringify(metadata) : null,
      durationMinutes
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

    // 에러→솔루션 자동 기록 (solutions 테이블)
    let solutionsRecorded = 0;
    if (transcript.errorFixPairs.length > 0) {
      try {
        for (const pair of transcript.errorFixPairs) {
          const existing = db.prepare(
            'SELECT id FROM solutions WHERE project = ? AND error_signature = ? LIMIT 1'
          ).get(project, pair.error);
          if (!existing) {
            db.prepare(
              'INSERT INTO solutions (project, error_signature, solution) VALUES (?, ?, ?)'
            ).run(project, pair.error, pair.fix);
            solutionsRecorded++;
          }
        }
      } catch { /* solutions table may not exist */ }
    }

    // architecture_decisions 자동 누적 (세션에서 추출된 결정사항 병합)
    if (decisions.length > 0) {
      try {
        const existing = db.prepare(
          'SELECT architecture_decisions FROM project_context WHERE project = ?'
        ).get(project) as { architecture_decisions: string } | undefined;

        let existingDecisions: string[] = [];
        if (existing?.architecture_decisions) {
          try { existingDecisions = JSON.parse(existing.architecture_decisions); } catch { /* ignore */ }
        }

        // 중복 제거 후 병합 (최대 20개 유지)
        const merged = [...new Set([...existingDecisions, ...decisions])].slice(-20);
        db.prepare(`
          INSERT INTO project_context (project, architecture_decisions)
          VALUES (?, ?)
          ON CONFLICT(project) DO UPDATE SET architecture_decisions = ?
        `).run(project, JSON.stringify(merged), JSON.stringify(merged));
      } catch { /* project_context table may not exist */ }
    }

    // 고품질 자동 메모리 추출 (v1.10 노이즈 제거 정책 유지하면서 가치 있는 것만)
    // - decisions: 의미있는 의사결정 (importance=7)
    // - commits: feat/fix만 (importance=6)
    // - 동일 content 중복 방지 (검색해서 없을 때만 INSERT)
    try {
      const memoryDupCheck = db.prepare(
        'SELECT id FROM memories WHERE project = ? AND content = ? LIMIT 1'
      );
      const memoryInsert = db.prepare(`
        INSERT INTO memories (content, memory_type, tags, project, importance)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const decision of decisions) {
        if (decision.length < 15) continue;
        if (!memoryDupCheck.get(project, decision)) {
          memoryInsert.run(decision, 'decision', JSON.stringify(['auto-extracted']), project, 7);
        }
      }

      // feat/fix 커밋만 (chore, docs, style은 학습 가치 낮음)
      for (const commit of commitMessages) {
        if (!/^(feat|fix)(\(.+\))?:/i.test(commit)) continue;
        if (commit.length < 20) continue;
        if (!memoryDupCheck.get(project, commit)) {
          memoryInsert.run(commit, 'learning', JSON.stringify(['auto-extracted', 'commit']), project, 6);
        }
      }
    } catch { /* memories table issue, skip */ }

    // 세션 임베딩 사전 생성 (search_sessions 성능 최적화)
    try {
      const lastSession = db.prepare(
        'SELECT id FROM sessions WHERE project = ? ORDER BY timestamp DESC LIMIT 1'
      ).get(project) as { id: number } | undefined;

      if (lastSession && lastWork) {
        // 간단한 임베딩은 동기적으로 시도하지 않고 DB에 표시만 남김
        // MCP 서버의 generateEmbedding이 search 시 캐시 miss에서 lazy 생성
        // session-end 훅은 transformers 모델 로드 오버헤드가 크므로 skip
      }
    } catch { /* ignore */ }

    db.close();

    console.log(`[SessionEnd] Saved session for ${project}`);
    console.log(`  Last work: ${lastWork.slice(0, 80)}`);
    console.log(`  Commits: ${commitMessages.length}, Decisions: ${decisions.length}, Errors: ${errorsSolved.length}`);
    console.log(`  Solutions auto-recorded: ${solutionsRecorded}`);
    console.log(`  Modified files: ${modifiedFiles.length}`);
    console.log(`  Next tasks: ${nextTasks.length}`);

    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
}

main();
