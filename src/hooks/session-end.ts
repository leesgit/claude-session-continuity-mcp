#!/usr/bin/env node
/**
 * SessionEnd Hook (Stop 이벤트) - 세션 종료 시 자동 저장
 *
 * Claude Code 세션 종료 시 자동으로 컨텍스트를 저장합니다.
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

interface SessionEndInput {
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
  const appsMatch = cwd.match(/apps[\/\\]([^\/\\]+)/);
  if (appsMatch) return appsMatch[1];

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

function extractSessionSummary(transcript: Array<{ role: string; content: string }>): {
  lastWork: string;
  nextTasks: string[];
  modifiedFiles: string[];
} {
  const lastWork: string[] = [];
  const nextTasks: string[] = [];
  const modifiedFiles = new Set<string>();

  // 최근 메시지 분석
  const recentMessages = transcript.slice(-30);

  for (const msg of recentMessages) {
    const content = msg.content;

    // 파일 수정 추출 (Edit, Write 도구 결과에서)
    const filePatterns = [
      /(?:edited|modified|updated|created|wrote)\s+[`"]?([^\s`"]+\.[a-z]+)/gi,
      /file[:\s]+[`"]?([^\s`"]+\.[a-z]+)/gi,
    ];

    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1] && !match[1].includes('...')) {
          modifiedFiles.add(match[1]);
        }
      }
    }

    if (msg.role === 'assistant') {
      // 완료된 작업 추출
      const donePatterns = [
        /(?:completed|finished|done|완료|수정)[:\s]*([^.!?\n]+)/gi,
        /(?:implemented|added|fixed|created)[:\s]*([^.!?\n]+)/gi,
      ];

      for (const pattern of donePatterns) {
        const match = pattern.exec(content);
        if (match && match[1]) {
          const work = match[1].trim().slice(0, 100);
          if (work.length > 10) lastWork.push(work);
        }
      }

      // 다음 할 일 추출
      const nextPatterns = [
        /(?:next|todo|remaining|다음)[:\s]*([^.!?\n]+)/gi,
        /(?:should|need to|필요)[:\s]*([^.!?\n]+)/gi,
      ];

      for (const pattern of nextPatterns) {
        const match = pattern.exec(content);
        if (match && match[1]) {
          const task = match[1].trim().slice(0, 100);
          if (task.length > 10) nextTasks.push(task);
        }
      }
    }
  }

  return {
    lastWork: lastWork.slice(0, 3).join('; ') || 'Session work completed',
    nextTasks: [...new Set(nextTasks)].slice(0, 5),
    modifiedFiles: [...modifiedFiles].slice(0, 10)
  };
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

    if (!fs.existsSync(dbPath)) {
      console.log('[SessionEnd] No DB found, skipping');
      process.exit(0);
    }

    const db = new Database(dbPath);

    // transcript에서 세션 요약 추출
    const summary = input.transcript
      ? extractSessionSummary(input.transcript)
      : { lastWork: 'Session ended', nextTasks: [], modifiedFiles: [] };

    // 세션 기록 저장
    db.prepare(`
      INSERT INTO sessions (project, last_work, next_tasks, modified_files)
      VALUES (?, ?, ?, ?)
    `).run(
      project,
      summary.lastWork,
      JSON.stringify(summary.nextTasks),
      JSON.stringify(summary.modifiedFiles)
    );

    // 활성 컨텍스트 업데이트
    db.prepare(`
      INSERT OR REPLACE INTO active_context (project, current_state, recent_files, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(
      project,
      summary.lastWork,
      JSON.stringify(summary.modifiedFiles)
    );

    db.close();

    console.log(`[SessionEnd] Saved session for ${project}`);
    console.log(`  Last work: ${summary.lastWork.slice(0, 50)}...`);
    console.log(`  Modified files: ${summary.modifiedFiles.length}`);
    console.log(`  Next tasks: ${summary.nextTasks.length}`);

    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
}

main();
