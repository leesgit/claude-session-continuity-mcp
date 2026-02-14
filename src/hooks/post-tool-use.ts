#!/usr/bin/env node
/**
 * PostToolUse Hook - 파일 변경 시 자동 기록
 *
 * Edit, Write 도구 사용 후 변경 사항을 메모리에 기록합니다.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';

interface ToolUseInput {
  cwd?: string;
  sessionId?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    command?: string;
    old_string?: string;
    new_string?: string;
    content?: string;
  };
  tool_result?: string;
}

function getDbPath(): string {
  const claudeDir = path.join(os.homedir(), '.claude');
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

function getFileExtension(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

function categorizeChange(toolName: string, filePath: string, oldString?: string, newString?: string): {
  changeType: string;
  summary: string;
} {
  const ext = getFileExtension(filePath);
  const fileName = path.basename(filePath);

  // 파일 타입별 분류
  const isConfig = ['json', 'yaml', 'yml', 'toml', 'env'].includes(ext) || fileName.includes('config');
  const isTest = filePath.includes('test') || filePath.includes('spec');
  const isStyle = ['css', 'scss', 'less', 'styled'].some(s => filePath.includes(s));
  const isComponent = ['tsx', 'jsx', 'vue', 'svelte'].includes(ext);

  let changeType = 'code';
  if (isConfig) changeType = 'config';
  else if (isTest) changeType = 'test';
  else if (isStyle) changeType = 'style';
  else if (isComponent) changeType = 'component';

  // 변경 요약 생성
  let summary = '';
  if (toolName === 'Write') {
    summary = `Created ${fileName}`;
  } else if (toolName === 'Edit') {
    if (oldString && newString) {
      const added = newString.split('\n').length;
      const removed = oldString.split('\n').length;
      if (added > removed) {
        summary = `Added ${added - removed} lines to ${fileName}`;
      } else if (removed > added) {
        summary = `Removed ${removed - added} lines from ${fileName}`;
      } else {
        summary = `Modified ${fileName}`;
      }
    } else {
      summary = `Modified ${fileName}`;
    }
  }

  return { changeType, summary };
}

async function main() {
  try {
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input: ToolUseInput = inputData ? JSON.parse(inputData) : {};

    const TRACKED_TOOLS = ['Edit', 'Write', 'Read', 'Glob', 'Grep'];
    const IGNORED_PATTERNS = ['node_modules', '.git/', 'dist/', 'build/', '.next/', 'coverage/', '.DS_Store'];

    const toolName = input.tool_name;
    if (!toolName || !TRACKED_TOOLS.includes(toolName)) {
      process.exit(0);
    }

    // Read/Glob/Grep에서도 파일 경로 추출
    let filePath = input.tool_input?.file_path;
    if (!filePath && toolName === 'Glob') {
      // Glob의 경우 path 파라미터 사용
      filePath = (input.tool_input as Record<string, unknown>)?.path as string;
    }
    if (!filePath && toolName === 'Grep') {
      filePath = (input.tool_input as Record<string, unknown>)?.path as string;
    }

    if (!filePath) {
      process.exit(0);
    }

    // 무시 패턴 체크
    if (IGNORED_PATTERNS.some(p => filePath!.includes(p))) {
      process.exit(0);
    }

    const cwd = input.cwd || process.cwd();
    const project = detectProject(cwd);
    const dbPath = getDbPath();

    if (!fs.existsSync(dbPath)) {
      process.exit(0);
    }

    const db = new Database(dbPath);

    // hot_paths 추적 (모든 추적 도구)
    try {
      const pathType = filePath.includes('.') ? 'file' : 'directory';
      db.prepare(`
        INSERT INTO hot_paths (project, file_path, access_count, last_accessed, path_type)
        VALUES (?, ?, 1, datetime('now'), ?)
        ON CONFLICT(project, file_path) DO UPDATE SET
          access_count = access_count + 1,
          last_accessed = datetime('now')
      `).run(project, filePath, pathType);

      // 7일 이상 된 경로의 access_count decay (반으로 줄임)
      db.prepare(`
        UPDATE hot_paths
        SET access_count = MAX(1, access_count / 2)
        WHERE project = ? AND last_accessed < datetime('now', '-7 days')
      `).run(project);
    } catch {
      // hot_paths 테이블 미존재 시 무시
    }

    // Edit, Write만 상세 추적 (기존 로직)
    if (['Edit', 'Write'].includes(toolName)) {
      const { changeType, summary } = categorizeChange(
        toolName,
        filePath,
        input.tool_input?.old_string,
        input.tool_input?.new_string
      );

      try {
        // 간단한 방식으로 recent_files 업데이트
        const existing = db.prepare('SELECT recent_files FROM active_context WHERE project = ?').get(project) as { recent_files: string } | undefined;

        let recentFiles: string[] = [];
        if (existing?.recent_files) {
          try {
            recentFiles = JSON.parse(existing.recent_files);
          } catch {
            recentFiles = [];
          }
        }

        // 중복 제거하고 최신 파일 추가 (최대 10개)
        recentFiles = recentFiles.filter(f => f !== filePath);
        recentFiles.unshift(filePath);
        recentFiles = recentFiles.slice(0, 10);

        db.prepare(`
          INSERT OR REPLACE INTO active_context (project, recent_files, updated_at)
          VALUES (?, ?, datetime('now'))
        `).run(project, JSON.stringify(recentFiles));

      } catch {
        // 오류 시 무시
      }

      // 중요 변경사항은 메모리에 기록 (하루에 같은 파일 중복 방지)
      const today = new Date().toISOString().slice(0, 10);
      const existingMemory = db.prepare(`
        SELECT id FROM memories
        WHERE project = ?
          AND content LIKE ?
          AND date(created_at) = ?
      `).get(project, `%${path.basename(filePath)}%`, today);

      if (!existingMemory) {
        db.prepare(`
          INSERT INTO memories (content, memory_type, project, importance, tags)
          VALUES (?, 'observation', ?, 3, ?)
        `).run(
          `[File Change] ${summary}`,
          project,
          `auto-tracked,${changeType},${getFileExtension(filePath)}`
        );
      }
    }

    db.close();
    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
}

main();
