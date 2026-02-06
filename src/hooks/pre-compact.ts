#!/usr/bin/env node
/**
 * PreCompact Hook - 컨텍스트 압축 전 중요 메모리 저장
 *
 * 컨텍스트가 압축되기 전에 현재 세션의 중요 정보를 메모리에 저장합니다.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';

interface CompactInput {
  cwd?: string;
  sessionId?: string;
  transcript?: Array<{
    role: string;
    content: string;
  }>;
}

function getDbPath(): string {
  // 글로벌 DB 경로
  const claudeDir = path.join(os.homedir(), '.claude');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  return path.join(claudeDir, 'sessions.db');
}

function detectProject(cwd: string): string {
  // apps/ 하위 프로젝트 감지
  const appsMatch = cwd.match(/apps[\/\\]([^\/\\]+)/);
  if (appsMatch) return appsMatch[1];

  // package.json 기반
  let current = cwd;
  while (current !== path.parse(current).root) {
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

  return path.basename(cwd);
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
    const dbPath = getDbPath();

    if (!fs.existsSync(dbPath)) {
      console.log('[PreCompact] No DB found, skipping');
      process.exit(0);
    }

    const db = new Database(dbPath);

    // 현재 활성 컨텍스트 저장
    const activeStmt = db.prepare(`
      INSERT OR REPLACE INTO active_context (project, current_state, updated_at)
      VALUES (?, ?, datetime('now'))
    `);

    // transcript에서 핵심 포인트 추출
    const keyPoints = input.transcript ? extractKeyPoints(input.transcript) : [];

    if (keyPoints.length > 0) {
      // 중요 메모리로 저장
      const memoryStmt = db.prepare(`
        INSERT INTO memories (content, memory_type, project, importance, tags)
        VALUES (?, 'pattern', ?, 8, 'auto-compact,session-summary')
      `);

      const summary = `[Pre-Compact Summary] ${keyPoints.join(' | ')}`;
      memoryStmt.run(summary, project);

      // 활성 컨텍스트 업데이트
      activeStmt.run(project, `Compacted: ${keyPoints[0]?.slice(0, 50) || 'Session context saved'}`);

      console.log(`[PreCompact] Saved ${keyPoints.length} key points for ${project}`);
    } else {
      console.log(`[PreCompact] No key points extracted for ${project}`);
    }

    db.close();
    process.exit(0);
  } catch (e) {
    // 에러 시 조용히 종료
    process.exit(0);
  }
}

main();
