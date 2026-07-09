// 구조화된 로깅 시스템
import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  tool?: string;
  message: string;
  data?: Record<string, unknown>;
  duration?: number;
}

// 민감 정보 패턴
const SENSITIVE_PATTERNS = [
  /password["\s:=]+["']?[\w\-!@#$%^&*]+["']?/gi,
  /api[_-]?key["\s:=]+["']?[\w\-]+["']?/gi,
  /token["\s:=]+["']?[\w\-\.]+["']?/gi,
  /secret["\s:=]+["']?[\w\-]+["']?/gi,
  /Bearer\s+[\w\-\.]+/gi
];

class Logger {
  private level: LogLevel;
  private logFile: string | null;

  constructor() {
    this.level = (process.env.LOG_LEVEL as LogLevel) || 'info';
    this.logFile = process.env.LOG_FILE || null;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private maskSensitive(text: string): string {
    let masked = text;
    for (const pattern of SENSITIVE_PATTERNS) {
      masked = masked.replace(pattern, '[REDACTED]');
    }
    return masked;
  }

  private formatEntry(entry: LogEntry): string {
    const json = JSON.stringify(entry, (_, value) => {
      if (typeof value === 'string') {
        return this.maskSensitive(value);
      }
      return value;
    });
    return json;
  }

  private write(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;

    const formatted = this.formatEntry(entry);

    // stderr로 출력 (MCP는 stdout을 통신에 사용)
    console.error(formatted);

    // 파일 로깅 (설정된 경우)
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, formatted + '\n');
      } catch {
        // 파일 쓰기 실패 무시
      }
    }
  }

  debug(message: string, data?: Record<string, unknown>, tool?: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'debug',
      tool,
      message,
      data
    });
  }

  info(message: string, data?: Record<string, unknown>, tool?: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'info',
      tool,
      message,
      data
    });
  }

  warn(message: string, data?: Record<string, unknown>, tool?: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'warn',
      tool,
      message,
      data
    });
  }

  error(message: string, data?: Record<string, unknown>, tool?: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'error',
      tool,
      message,
      data
    });
  }

  // 도구 실행 래퍼 - 성능 측정 포함
  async withTool<T>(
    toolName: string,
    fn: () => Promise<T>,
    args?: Record<string, unknown>
  ): Promise<T> {
    const start = Date.now();
    this.debug(`Tool started`, { args }, toolName);

    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.info(`Tool completed`, { duration }, toolName);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.error(`Tool failed`, {
        duration,
        error: error instanceof Error ? error.message : String(error)
      }, toolName);
      throw error;
    }
  }
}

// 싱글톤 인스턴스
export const logger = new Logger();

/**
 * Hook 치명적 오류 로거 — outer catch 전용.
 *
 * 배경: 2026-07-08, Node를 v26(ABI 147)로 업그레이드하면서 better-sqlite3
 * 네이티브 모듈(ABI 141)이 로드 실패 → 5개 hook 전부 outer catch에서
 * 조용히 exit(0). 18일간 세션이 한 건도 저장되지 않았는데 아무 흔적도 없었음.
 * fail-soft는 유지하되, 반드시 흔적을 남긴다.
 *
 * 로그 위치: $HOOK_ERROR_LOG > cwd/.claude/hook-errors.log > ~/.claude/hook-errors.log
 */
export function logHookError(hook: string, err: unknown): void {
  try {
    const candidates = [
      process.env.HOOK_ERROR_LOG,
      path.join(process.cwd(), '.claude', 'hook-errors.log'),
      path.join(process.env.HOME || '/tmp', '.claude', 'hook-errors.log'),
    ].filter(Boolean) as string[];
    const line = `[${new Date().toISOString()}] hook=${hook} ${err instanceof Error ? (err.stack || err.message) : String(err)}\n`;
    for (const p of candidates) {
      try {
        fs.appendFileSync(p, line);
        return;
      } catch { /* try next candidate */ }
    }
  } catch { /* never throw from the error logger */ }
}

/**
 * Detect whether the hook is running under OpenAI Codex CLI (vs Claude Code).
 * Codex stores transcripts at ~/.codex/sessions/...rollout-*.jsonl.
 */
export function isCodexHost(transcriptPath?: string): boolean {
  if (!transcriptPath) return false;
  return transcriptPath.includes('/.codex/sessions/') || /rollout-.*\.jsonl$/.test(transcriptPath);
}

/**
 * Emit context to stdout in the host's expected format (Codex support, 2026-07-09).
 * - Claude Code injects raw stdout text directly.
 * - Codex CLI expects {hookSpecificOutput:{hookEventName, additionalContext}}.
 */
export function emitContext(context: string, hookEventName: string, transcriptPath?: string): void {
  if (isCodexHost(transcriptPath)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName, additionalContext: context },
    }));
  } else {
    console.log(context);
  }
}
