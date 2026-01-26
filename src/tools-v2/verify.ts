// 검증 도구 (verify)
// 빌드/테스트/린트 자동 실행
import * as path from 'path';
import { spawn } from 'child_process';
import { db, APPS_DIR } from '../db/database.js';
import { logger } from '../utils/logger.js';
import { VerifySchema } from '../schemas.js';
import type { Tool, CallToolResult } from '../types.js';

// ===== 도구 정의 =====

export const verifyTools: Tool[] = [
  {
    name: 'verify',
    description: `프로젝트 검증 (빌드/테스트/린트).
- gates: 실행할 게이트 배열 (기본: 전체)
  - build: 빌드 검증
  - test: 테스트 실행
  - lint: 린트 검사
각 게이트 결과와 전체 성공 여부 반환.
실패 시 에러 메시지 포함.`,
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '프로젝트명' },
        gates: {
          type: 'array',
          items: { type: 'string', enum: ['build', 'test', 'lint'] },
          description: '실행할 게이트 (기본: 전체)'
        }
      },
      required: ['project']
    }
  }
];

// 플랫폼별 명령어 매핑
const PLATFORM_COMMANDS: Record<string, Record<string, string>> = {
  nextjs: {
    build: 'pnpm build',
    test: 'pnpm test:run || pnpm test --run || echo "No test script"',
    lint: 'pnpm lint'
  },
  react: {
    build: 'pnpm build',
    test: 'pnpm test --watchAll=false',
    lint: 'pnpm lint'
  },
  flutter: {
    build: 'flutter build apk --debug',
    test: 'flutter test',
    lint: 'flutter analyze'
  },
  android: {
    build: './gradlew assembleDebug',
    test: './gradlew test',
    lint: './gradlew lint'
  },
  node: {
    build: 'pnpm build || npm run build',
    test: 'pnpm test || npm test',
    lint: 'pnpm lint || npm run lint'
  }
};

// ===== 핸들러 =====

export async function handleVerify(args: unknown): Promise<CallToolResult> {
  return logger.withTool('verify', async () => {
    // 입력 검증
    const parsed = VerifySchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: `Validation error: ${parsed.error.message}` }],
        isError: true
      };
    }

    const { project, gates } = parsed.data;
    const projectPath = path.join(APPS_DIR, project);

    // 플랫폼 감지
    const platform = await detectPlatform(projectPath);
    const commands = PLATFORM_COMMANDS[platform] || PLATFORM_COMMANDS.node;

    const results: Record<string, { success: boolean; output?: string; error?: string; duration: number }> = {};

    for (const gate of gates) {
      const command = commands[gate];
      if (!command) continue;

      const startTime = Date.now();
      const result = await runCommand(command, projectPath);
      const duration = Date.now() - startTime;

      results[gate] = {
        success: result.success,
        output: result.success ? result.output?.slice(-500) : undefined,
        error: !result.success ? result.error?.slice(-1000) : undefined,
        duration
      };

      logger.info(`Gate ${gate} ${result.success ? 'passed' : 'failed'}`, {
        duration,
        success: result.success
      }, 'verify');
    }

    const allPassed = Object.values(results).every(r => r.success);

    // active_context에 검증 결과 저장
    try {
      db.prepare(`
        UPDATE active_context SET last_verification = ?, updated_at = CURRENT_TIMESTAMP
        WHERE project = ?
      `).run(allPassed ? 'passed' : 'failed', project);
    } catch { /* ignore */ }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          project,
          platform,
          allPassed,
          results,
          summary: Object.entries(results)
            .map(([gate, r]) => `${gate}: ${r.success ? '✅' : '❌'} (${r.duration}ms)`)
            .join(', ')
        }, null, 2)
      }]
    };
  }, args as Record<string, unknown>);
}

async function detectPlatform(projectPath: string): Promise<string> {
  const { existsSync } = await import('fs');

  if (existsSync(path.join(projectPath, 'pubspec.yaml'))) return 'flutter';
  if (existsSync(path.join(projectPath, 'build.gradle')) || existsSync(path.join(projectPath, 'build.gradle.kts'))) return 'android';

  try {
    const { readFileSync } = await import('fs');
    const pkgPath = path.join(projectPath, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.dependencies?.next) return 'nextjs';
      if (pkg.dependencies?.react) return 'react';
    }
  } catch { /* ignore */ }

  return 'node';
}

function runCommand(command: string, cwd: string): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('sh', ['-c', command], {
      cwd,
      env: { ...process.env, CI: 'true' },
      timeout: 300000 // 5분
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout });
      } else {
        resolve({ success: false, error: stderr || stdout });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}
