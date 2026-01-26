// 프로젝트 관리 도구 (7개)
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import { db, APPS_DIR } from '../db/database.js';
import { fileExists, readFileContent, writeFileContent, parseMarkdownTable } from '../utils/helpers.js';
import type { Tool, CallToolResult } from '../types.js';
import { textResult } from '../types.js';

// ===== 도구 정의 =====

export const projectTools: Tool[] = [
  {
    name: 'list_projects',
    description: 'apps/ 디렉토리의 모든 프로젝트 목록과 상태를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
    }
  },
  {
    name: 'get_session',
    description: '프로젝트의 SESSION.md를 파싱하여 구조화된 데이터로 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '프로젝트 이름' },
        includeRaw: { type: 'boolean', description: 'raw 전체 내용 포함 여부 (기본: false, 응답 크기 줄이기)' },
        maxContentLength: { type: 'number', description: '최대 내용 길이 (기본: 2000, 0이면 무제한)' }
      },
      required: ['project']
    }
  },
  {
    name: 'update_session',
    description: '프로젝트의 SESSION.md를 업데이트하고 DB에 이력을 저장합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '프로젝트 이름' },
        lastWork: { type: 'string', description: '마지막 작업 내용' },
        currentStatus: { type: 'string', description: '현재 상태' },
        nextTasks: { type: 'array', items: { type: 'string' }, description: '다음 작업 목록' },
        modifiedFiles: { type: 'array', items: { type: 'string' }, description: '수정된 파일 목록' },
        issues: { type: 'array', items: { type: 'string' }, description: '알려진 이슈' },
        verificationResult: { type: 'string', description: '검증 결과 (passed/failed)' }
      },
      required: ['project', 'lastWork']
    }
  },
  {
    name: 'get_tech_stack',
    description: '프로젝트의 plan.md에서 기술 스택 정보를 추출합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '프로젝트 이름' }
      },
      required: ['project']
    }
  },
  {
    name: 'run_verification',
    description: '프로젝트의 빌드/테스트/린트를 한 번에 실행하고 결과를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '프로젝트 이름' },
        gates: {
          type: 'array',
          items: { type: 'string', enum: ['build', 'test', 'lint'] },
          description: '실행할 게이트 목록 (기본: 전체)'
        }
      },
      required: ['project']
    }
  },
  {
    name: 'detect_platform',
    description: '프로젝트의 플랫폼을 자동 감지합니다 (Web, Android, Flutter, Server).',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '프로젝트 이름' }
      },
      required: ['project']
    }
  },
  {
    name: 'get_project_stats',
    description: '프로젝트별 작업 통계를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '프로젝트 이름 (없으면 전체)' }
      }
    }
  }
];

// ===== 핸들러 =====

export async function listProjects(): Promise<CallToolResult> {
  try {
    const entries = await fs.readdir(APPS_DIR, { withFileTypes: true });
    const projects = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const projectPath = path.join(APPS_DIR, entry.name);
      const sessionPath = path.join(projectPath, 'docs', 'SESSION.md');
      const planPath = path.join(projectPath, 'plan.md');

      const hasSession = await fileExists(sessionPath);
      const hasPlan = await fileExists(planPath);

      // 플랫폼 감지
      let platform = 'Unknown';
      if (await fileExists(path.join(projectPath, 'package.json'))) {
        platform = 'Web';
      } else if (await fileExists(path.join(projectPath, 'build.gradle.kts')) ||
                 await fileExists(path.join(projectPath, 'build.gradle'))) {
        platform = 'Android';
      } else if (await fileExists(path.join(projectPath, 'pubspec.yaml'))) {
        platform = 'Flutter';
      }

      projects.push({
        name: entry.name,
        path: projectPath,
        platform,
        hasSession,
        hasPlan
      });
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ projects, count: projects.length }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}

export async function getSession(
  project: string,
  includeRaw: boolean = false,
  maxContentLength: number = 2000
): Promise<CallToolResult> {
  const sessionPath = path.join(APPS_DIR, project, 'docs', 'SESSION.md');
  const content = await readFileContent(sessionPath);

  if (!content) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ exists: false, project }) }]
    };
  }

  const session: Record<string, unknown> = {
    exists: true,
    project
  };

  // 마지막 업데이트 추출
  const updateMatch = content.match(/마지막 업데이트[:\s]*(.+)/);
  if (updateMatch) {
    session.lastUpdate = updateMatch[1].trim();
  }

  // 현재 상태 추출
  const statusMatch = content.match(/현재 상태[:\s]*(.+)/);
  if (statusMatch) {
    session.currentStatus = statusMatch[1].trim();
  }

  // 다음 작업 추출
  const nextTasksMatch = content.match(/다음 작업[^:]*:([\s\S]*?)(?=##|$)/);
  if (nextTasksMatch) {
    const tasks = nextTasksMatch[1].match(/[-*]\s*(.+)/g);
    session.nextTasks = tasks?.map(t => t.replace(/^[-*]\s*/, '').trim()) || [];
  }

  // 수정된 파일 추출
  const filesMatch = content.match(/수정된 파일[^:]*:([\s\S]*?)(?=##|$)/);
  if (filesMatch) {
    const files = filesMatch[1].match(/[-*]\s*(.+)/g);
    session.modifiedFiles = files?.map(f => f.replace(/^[-*]\s*/, '').trim()) || [];
  }

  // 이슈 추출
  const issuesMatch = content.match(/(?:알려진 )?이슈[^:]*:([\s\S]*?)(?=##|$)/);
  if (issuesMatch) {
    const issues = issuesMatch[1].match(/[-*]\s*(.+)/g);
    session.issues = issues?.map(i => i.replace(/^[-*]\s*/, '').trim()) || [];
  }

  // raw 내용 (선택적)
  if (includeRaw) {
    if (maxContentLength > 0 && content.length > maxContentLength) {
      session.raw = content.slice(0, maxContentLength);
      session.truncated = true;
      session.totalLength = content.length;
    } else {
      session.raw = content;
      session.truncated = false;
    }
  }

  session.contentLength = content.length;

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(session, null, 2) }]
  };
}

export async function updateSession(
  project: string,
  lastWork: string,
  currentStatus?: string,
  nextTasks?: string[],
  modifiedFiles?: string[],
  issues?: string[],
  verificationResult?: string
): Promise<CallToolResult> {
  const sessionPath = path.join(APPS_DIR, project, 'docs', 'SESSION.md');
  const now = new Date().toISOString().split('T')[0];

  let content = `# SESSION - ${project}

## 마지막 업데이트
- **날짜**: ${now}
- **작업**: ${lastWork}

## 현재 상태
${currentStatus || '진행 중'}

`;

  if (nextTasks && nextTasks.length > 0) {
    content += `## 다음 작업
${nextTasks.map(t => `- ${t}`).join('\n')}

`;
  }

  if (modifiedFiles && modifiedFiles.length > 0) {
    content += `## 수정된 파일
${modifiedFiles.map(f => `- ${f}`).join('\n')}

`;
  }

  if (issues && issues.length > 0) {
    content += `## 알려진 이슈
${issues.map(i => `- ${i}`).join('\n')}
`;
  }

  await writeFileContent(sessionPath, content);

  // DB에도 자동 저장
  try {
    const stmt = db.prepare(`
      INSERT INTO sessions (project, last_work, current_status, next_tasks, modified_files, issues, verification_result)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      project,
      lastWork,
      currentStatus || null,
      nextTasks ? JSON.stringify(nextTasks) : null,
      modifiedFiles ? JSON.stringify(modifiedFiles) : null,
      issues ? JSON.stringify(issues) : null,
      verificationResult || null
    );
  } catch (dbError) {
    console.error('DB save error:', dbError);
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: true, path: sessionPath, savedToDb: true }) }]
  };
}

export async function getTechStack(project: string): Promise<CallToolResult> {
  const planPath = path.join(APPS_DIR, project, 'plan.md');
  const content = await readFileContent(planPath);

  if (!content) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ exists: false, project }) }]
    };
  }

  const stack = parseMarkdownTable(content, '기술 스택');
  const commands = parseMarkdownTable(content, '명령어');

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        exists: true,
        project,
        techStack: stack,
        commands: commands
      }, null, 2)
    }]
  };
}

export async function runVerification(project: string, gates?: string[]): Promise<CallToolResult> {
  const projectPath = path.join(APPS_DIR, project);
  const planPath = path.join(projectPath, 'plan.md');

  const planContent = await readFileContent(planPath);
  let commands: Record<string, string> = {};

  if (planContent) {
    commands = parseMarkdownTable(planContent, '명령어');
  }

  // 플랫폼별 기본 명령어
  const defaultCommands: Record<string, Record<string, string>> = {
    Web: { build: 'pnpm build', test: 'pnpm test:run', lint: 'pnpm lint' },
    Android: { build: './gradlew assembleDebug', test: './gradlew test', lint: './gradlew lint' },
    Flutter: { build: 'flutter build', test: 'flutter test', lint: 'flutter analyze' }
  };

  // 플랫폼 감지
  let platform = 'Web';
  if (await fileExists(path.join(projectPath, 'build.gradle.kts')) ||
      await fileExists(path.join(projectPath, 'build.gradle'))) {
    platform = 'Android';
  } else if (await fileExists(path.join(projectPath, 'pubspec.yaml'))) {
    platform = 'Flutter';
  }

  const finalCommands = { ...defaultCommands[platform], ...commands };
  const gatesToRun = gates || ['build', 'test', 'lint'];

  const results: Record<string, { success: boolean; output: string }> = {};

  for (const gate of gatesToRun) {
    const cmd = finalCommands[gate === 'build' ? '빌드' : gate === 'test' ? '테스트' : '린트']
             || finalCommands[gate];

    if (!cmd) {
      results[gate] = { success: false, output: `No command found for ${gate}` };
      continue;
    }

    try {
      const output = execSync(cmd, {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 300000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      results[gate] = { success: true, output: output.slice(-1000) };
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; message?: string };
      results[gate] = {
        success: false,
        output: (execError.stdout || execError.stderr || execError.message || 'Unknown error').slice(-1000)
      };
    }
  }

  const allPassed = Object.values(results).every(r => r.success);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        project,
        platform,
        allPassed,
        results
      }, null, 2)
    }]
  };
}

export async function detectPlatform(project: string): Promise<CallToolResult> {
  const projectPath = path.join(APPS_DIR, project);

  const checks = {
    'package.json': 'Web',
    'build.gradle.kts': 'Android',
    'build.gradle': 'Android',
    'pubspec.yaml': 'Flutter',
    'go.mod': 'Server (Go)',
    'Cargo.toml': 'Server (Rust)',
    'pom.xml': 'Server (Java)',
    'requirements.txt': 'Server (Python)'
  };

  for (const [file, platform] of Object.entries(checks)) {
    if (await fileExists(path.join(projectPath, file))) {
      const info: Record<string, unknown> = { platform };

      if (file === 'package.json') {
        const pkg = JSON.parse(await readFileContent(path.join(projectPath, file)) || '{}');
        info.framework = pkg.dependencies?.next ? 'Next.js' :
                        pkg.dependencies?.react ? 'React' :
                        pkg.dependencies?.vue ? 'Vue' : 'Unknown';
      }

      if (file === 'pubspec.yaml') {
        const content = await readFileContent(path.join(projectPath, file)) || '';
        info.hasFlame = content.includes('flame:');
        info.hasRiverpod = content.includes('riverpod');
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ project, ...info }) }]
      };
    }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ project, platform: 'Unknown' }) }]
  };
}

export function getProjectStats(project?: string): CallToolResult {
  try {
    let query = `
      SELECT
        project,
        COUNT(*) as total_sessions,
        SUM(CASE WHEN verification_result = 'passed' THEN 1 ELSE 0 END) as passed_count,
        AVG(duration_minutes) as avg_duration,
        MAX(timestamp) as last_activity
      FROM sessions
    `;

    if (project) {
      query += ` WHERE project = ?`;
    }

    query += ` GROUP BY project ORDER BY last_activity DESC`;

    const stmt = db.prepare(query);
    const rows = project ? stmt.all(project) : stmt.all();

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ stats: rows }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}
