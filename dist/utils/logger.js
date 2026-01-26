// 구조화된 로깅 시스템
import * as fs from 'fs';
// 민감 정보 패턴
const SENSITIVE_PATTERNS = [
    /password["\s:=]+["']?[\w\-!@#$%^&*]+["']?/gi,
    /api[_-]?key["\s:=]+["']?[\w\-]+["']?/gi,
    /token["\s:=]+["']?[\w\-\.]+["']?/gi,
    /secret["\s:=]+["']?[\w\-]+["']?/gi,
    /Bearer\s+[\w\-\.]+/gi
];
class Logger {
    level;
    logFile;
    constructor() {
        this.level = process.env.LOG_LEVEL || 'info';
        this.logFile = process.env.LOG_FILE || null;
    }
    shouldLog(level) {
        const levels = ['debug', 'info', 'warn', 'error'];
        return levels.indexOf(level) >= levels.indexOf(this.level);
    }
    maskSensitive(text) {
        let masked = text;
        for (const pattern of SENSITIVE_PATTERNS) {
            masked = masked.replace(pattern, '[REDACTED]');
        }
        return masked;
    }
    formatEntry(entry) {
        const json = JSON.stringify(entry, (_, value) => {
            if (typeof value === 'string') {
                return this.maskSensitive(value);
            }
            return value;
        });
        return json;
    }
    write(entry) {
        if (!this.shouldLog(entry.level))
            return;
        const formatted = this.formatEntry(entry);
        // stderr로 출력 (MCP는 stdout을 통신에 사용)
        console.error(formatted);
        // 파일 로깅 (설정된 경우)
        if (this.logFile) {
            try {
                fs.appendFileSync(this.logFile, formatted + '\n');
            }
            catch {
                // 파일 쓰기 실패 무시
            }
        }
    }
    debug(message, data, tool) {
        this.write({
            timestamp: new Date().toISOString(),
            level: 'debug',
            tool,
            message,
            data
        });
    }
    info(message, data, tool) {
        this.write({
            timestamp: new Date().toISOString(),
            level: 'info',
            tool,
            message,
            data
        });
    }
    warn(message, data, tool) {
        this.write({
            timestamp: new Date().toISOString(),
            level: 'warn',
            tool,
            message,
            data
        });
    }
    error(message, data, tool) {
        this.write({
            timestamp: new Date().toISOString(),
            level: 'error',
            tool,
            message,
            data
        });
    }
    // 도구 실행 래퍼 - 성능 측정 포함
    async withTool(toolName, fn, args) {
        const start = Date.now();
        this.debug(`Tool started`, { args }, toolName);
        try {
            const result = await fn();
            const duration = Date.now() - start;
            this.info(`Tool completed`, { duration }, toolName);
            return result;
        }
        catch (error) {
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
