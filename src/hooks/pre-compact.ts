#!/usr/bin/env node
/**
 * PreCompact Hook v2 - 컨텍스트 압축 전 구조화된 HANDOVER 생성
 *
 * 컴팩션 전에 대화 내용을 분석해 구조화된 컨텍스트를 systemMessage로 반환합니다.
 * v1과 달리 memories 테이블에 저장하지 않습니다 (노이즈 방지).
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

interface HandoverContext {
  workSummary: string;
  activeFile: string | null;
  pendingAction: string | null;
  keyFacts: string[];
  recentErrors: string[];
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

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

/**
 * 대화 transcript에서 구조화된 핸드오버 컨텍스트를 빌드합니다.
 */
function buildHandoverContext(
  transcript: Array<{ role: string; content: string }>
): HandoverContext {
  const context: HandoverContext = {
    workSummary: '',
    activeFile: null,
    pendingAction: null,
    keyFacts: [],
    recentErrors: []
  };

  const userMessages = transcript.filter(m => m.role === 'user');
  const assistantMessages = transcript.filter(m => m.role === 'assistant');

  // 1. workSummary: 첫 user 메시지 = 작업 요청
  if (userMessages.length > 0) {
    const first = userMessages[0].content;
    // 코드블록, 테이블 제거 후 첫 의미있는 라인
    const cleaned = first
      .replace(/```[\s\S]*?```/g, '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 10 && !l.startsWith('|') && !l.startsWith('---'));
    if (cleaned.length > 0) {
      context.workSummary = stripMarkdown(cleaned[0]).slice(0, 200);
    }
  }

  // 2. activeFile: 최근 메시지에서 파일 경로 추출
  const recentAll = transcript.slice(-10);
  for (const msg of recentAll.reverse()) {
    const filePatterns = [
      /(?:file_path|파일)[:\s]*["']?([^\s"',]+\.\w{1,6})/,
      /(?:Edit|Write|Read|수정|생성|읽기)\s+.*?(\S+\.\w{1,6})/,
      /`([^`]+\.\w{1,6})`/,
    ];
    for (const pattern of filePatterns) {
      const match = msg.content.match(pattern);
      if (match?.[1] && !match[1].includes('http')) {
        context.activeFile = match[1];
        break;
      }
    }
    if (context.activeFile) break;
  }

  // 3. pendingAction: 마지막 메시지가 user면 미완료 요청
  if (transcript.length > 0 && transcript[transcript.length - 1].role === 'user') {
    const lastUser = transcript[transcript.length - 1].content;
    const cleaned = stripMarkdown(lastUser.split('\n')[0] || lastUser);
    if (cleaned.length > 5) {
      context.pendingAction = cleaned.slice(0, 150);
    }
  }

  // 4. keyFacts: assistant 메시지에서 설정값, 포트, 버전 등 추출
  const factPatterns = [
    /(?:port|포트)\s*(?:is|=|:|→)\s*(\d{2,5})/gi,
    /(?:version|버전)\s*(?:is|=|:|→)\s*([\d.]+)/gi,
    /(?:IP|ip)\s*(?:is|=|:|→)\s*([\d.]+)/gi,
    /(?:using|사용)\s+([\w\s.-]+?\s+v[\d.]+)/gi,
  ];

  for (const msg of assistantMessages.slice(-10)) {
    for (const pattern of factPatterns) {
      pattern.lastIndex = 0;
      const match = msg.content.match(pattern);
      if (match) {
        context.keyFacts.push(stripMarkdown(match[0]).slice(0, 100));
      }
    }
  }
  context.keyFacts = [...new Set(context.keyFacts)].slice(0, 5);

  // 5. recentErrors: 에러 패턴 추출
  for (const msg of transcript.slice(-15)) {
    const errorMatch = msg.content.match(
      /(?:Error|error|ERROR|오류|실패|FAILED|Exception)[:\s](.{10,100})/
    );
    if (errorMatch) {
      const err = stripMarkdown(errorMatch[0]).slice(0, 100);
      if (!context.recentErrors.includes(err)) {
        context.recentErrors.push(err);
      }
    }
  }
  context.recentErrors = context.recentErrors.slice(0, 3);

  return context;
}

/**
 * Playwright 캐시 정리 - 오래된 스냅샷/로그 제거 (20MB 컨텍스트 초과 방지)
 */
function cleanPlaywrightCache(cwd: string) {
  const playwrightDir = path.join(cwd, '.playwright-mcp');
  if (!fs.existsSync(playwrightDir)) return;

  const now = Date.now();
  const MAX_AGE = 30 * 60 * 1000; // 30분 이상 된 파일 정리
  const MAX_DIR_SIZE = 5 * 1024 * 1024; // 5MB 초과 시 정리

  try {
    const files = fs.readdirSync(playwrightDir);
    let totalSize = 0;
    const fileInfos: { name: string; mtime: number; size: number }[] = [];

    for (const file of files) {
      const filePath = path.join(playwrightDir, file);
      const stat = fs.statSync(filePath);
      totalSize += stat.size;
      fileInfos.push({ name: file, mtime: stat.mtimeMs, size: stat.size });
    }

    if (totalSize < MAX_DIR_SIZE) return; // 5MB 미만이면 정리 불필요

    // 오래된 파일부터 삭제
    fileInfos.sort((a, b) => a.mtime - b.mtime);
    for (const fi of fileInfos) {
      if (now - fi.mtime > MAX_AGE) {
        fs.unlinkSync(path.join(playwrightDir, fi.name));
        totalSize -= fi.size;
      }
      if (totalSize < MAX_DIR_SIZE) break;
    }
  } catch { /* ignore */ }

  // 루트의 오래된 스크린샷 PNG/JPEG도 정리
  try {
    const rootFiles = fs.readdirSync(cwd);
    for (const file of rootFiles) {
      if (!/\.(png|jpeg|jpg)$/i.test(file)) continue;
      const filePath = path.join(cwd, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > MAX_AGE) {
        fs.unlinkSync(filePath);
      }
    }
  } catch { /* ignore */ }
}

async function main() {
  try {
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input: CompactInput = inputData ? JSON.parse(inputData) : {};
    const cwd = input.cwd || process.cwd();

    // Playwright 캐시 정리 (20MB 컨텍스트 초과 방지)
    cleanPlaywrightCache(cwd);
    const project = detectProject(cwd);
    const dbPath = getDbPath(cwd);

    if (!fs.existsSync(dbPath)) {
      process.stdout.write(JSON.stringify({ continue: true }));
      process.exit(0);
    }

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL'); // 다중 hook 프로세스 동시성 보장

    // 핸드오버 컨텍스트 빌드
    const handover = input.transcript ? buildHandoverContext(input.transcript) : null;

    // active_context 업데이트 (memories에는 저장하지 않음)
    if (handover?.workSummary) {
      const stateStr = [
        handover.workSummary,
        handover.activeFile ? `file: ${handover.activeFile}` : '',
        handover.pendingAction ? `pending: ${handover.pendingAction.slice(0, 50)}` : ''
      ].filter(Boolean).join(' | ');

      db.prepare(`
        INSERT OR REPLACE INTO active_context (project, current_state, updated_at)
        VALUES (?, ?, datetime('now'))
      `).run(project, stateStr.slice(0, 300));
    }

    // === 컨텍스트 재주입: systemMessage로 반환 ===
    const recoveryLines: string[] = [`# ${project} - Compact Recovery\n`];

    // 사용자 지시사항
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

    // 핸드오버 컨텍스트
    if (handover) {
      recoveryLines.push(`\n## Handover`);
      if (handover.workSummary) recoveryLines.push(`**Working on**: ${handover.workSummary}`);
      if (handover.activeFile) recoveryLines.push(`**Active file**: ${handover.activeFile}`);
      if (handover.pendingAction) recoveryLines.push(`**Pending**: ${handover.pendingAction}`);
      if (handover.keyFacts.length > 0) {
        recoveryLines.push('**Key facts**:');
        handover.keyFacts.forEach(f => recoveryLines.push(`- ${f}`));
      }
      if (handover.recentErrors.length > 0) {
        recoveryLines.push('**Recent errors**:');
        handover.recentErrors.forEach(e => recoveryLines.push(`- ${e}`));
      }
    }

    db.close();

    const output = {
      continue: true,
      systemMessage: recoveryLines.join('\n')
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (e) {
    // fail-soft: 컴팩션이 멈추지 않도록 continue:true 반드시 반환
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

main();
