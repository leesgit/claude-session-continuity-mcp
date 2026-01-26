// Logger 유틸리티 테스트
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 민감 정보 마스킹 테스트
describe('Sensitive Data Masking', () => {
  const SENSITIVE_PATTERNS = [
    /password["'\s:=]+["']?[\w\-!@#$%^&*]+["']?/gi,
    /api[_-]?key["'\s:=]+["']?[\w\-]+["']?/gi,
    /token["'\s:=]+["']?[\w\-\.]+["']?/gi,
    /secret["'\s:=]+["']?[\w\-]+["']?/gi,
    /Bearer\s+[\w\-\.]+/gi
  ];

  function maskSensitive(text: string): string {
    let masked = text;
    for (const pattern of SENSITIVE_PATTERNS) {
      masked = masked.replace(pattern, '[REDACTED]');
    }
    return masked;
  }

  it('should mask password in JSON format', () => {
    expect(maskSensitive('{"password": "secret123"}')).toContain('[REDACTED]');
  });

  it('should mask password with equals sign', () => {
    expect(maskSensitive('password=mypass123')).toBe('[REDACTED]');
  });

  it('should mask api_key', () => {
    expect(maskSensitive('api_key: sk-abc123')).toBe('[REDACTED]');
  });

  it('should mask apiKey (camelCase)', () => {
    expect(maskSensitive('apiKey="test-key-123"')).toBe('[REDACTED]');
  });

  it('should mask token', () => {
    expect(maskSensitive('token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIx')).toBe('[REDACTED]');
  });

  it('should mask Bearer token', () => {
    expect(maskSensitive('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9')).toContain('[REDACTED]');
  });

  it('should mask secret', () => {
    expect(maskSensitive('secret: my-secret-value')).toBe('[REDACTED]');
  });

  it('should not mask normal text', () => {
    expect(maskSensitive('Hello, this is normal text')).toBe('Hello, this is normal text');
  });

  it('should handle multiple sensitive values', () => {
    const input = 'password: abc, api_key: xyz, token: 123';
    const result = maskSensitive(input);
    expect(result).not.toContain('abc');
    expect(result).not.toContain('xyz');
    expect(result).not.toContain('123');
  });
});

// 로그 레벨 테스트
describe('Log Levels', () => {
  const levels = ['debug', 'info', 'warn', 'error'] as const;

  function shouldLog(currentLevel: string, messageLevel: string): boolean {
    const levelOrder = { debug: 0, info: 1, warn: 2, error: 3 };
    return levelOrder[messageLevel as keyof typeof levelOrder] >= levelOrder[currentLevel as keyof typeof levelOrder];
  }

  it('should allow all levels when set to debug', () => {
    expect(shouldLog('debug', 'debug')).toBe(true);
    expect(shouldLog('debug', 'info')).toBe(true);
    expect(shouldLog('debug', 'warn')).toBe(true);
    expect(shouldLog('debug', 'error')).toBe(true);
  });

  it('should filter debug when set to info', () => {
    expect(shouldLog('info', 'debug')).toBe(false);
    expect(shouldLog('info', 'info')).toBe(true);
    expect(shouldLog('info', 'warn')).toBe(true);
    expect(shouldLog('info', 'error')).toBe(true);
  });

  it('should only allow warn and error when set to warn', () => {
    expect(shouldLog('warn', 'debug')).toBe(false);
    expect(shouldLog('warn', 'info')).toBe(false);
    expect(shouldLog('warn', 'warn')).toBe(true);
    expect(shouldLog('warn', 'error')).toBe(true);
  });

  it('should only allow error when set to error', () => {
    expect(shouldLog('error', 'debug')).toBe(false);
    expect(shouldLog('error', 'info')).toBe(false);
    expect(shouldLog('error', 'warn')).toBe(false);
    expect(shouldLog('error', 'error')).toBe(true);
  });
});

// 로그 엔트리 포맷 테스트
describe('Log Entry Format', () => {
  interface LogEntry {
    timestamp: string;
    level: string;
    tool?: string;
    message: string;
    data?: Record<string, unknown>;
    duration?: number;
  }

  function formatEntry(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  it('should format basic log entry', () => {
    const entry: LogEntry = {
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'info',
      message: 'Test message'
    };

    const formatted = formatEntry(entry);
    const parsed = JSON.parse(formatted);

    expect(parsed.timestamp).toBe('2024-01-01T00:00:00.000Z');
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('Test message');
  });

  it('should include tool name when provided', () => {
    const entry: LogEntry = {
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'info',
      tool: 'memory_store',
      message: 'Tool executed'
    };

    const parsed = JSON.parse(formatEntry(entry));
    expect(parsed.tool).toBe('memory_store');
  });

  it('should include data when provided', () => {
    const entry: LogEntry = {
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'debug',
      message: 'Debug info',
      data: { count: 5, items: ['a', 'b'] }
    };

    const parsed = JSON.parse(formatEntry(entry));
    expect(parsed.data.count).toBe(5);
    expect(parsed.data.items).toEqual(['a', 'b']);
  });

  it('should include duration for tool execution', () => {
    const entry: LogEntry = {
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'info',
      tool: 'verify',
      message: 'Tool completed',
      duration: 1234
    };

    const parsed = JSON.parse(formatEntry(entry));
    expect(parsed.duration).toBe(1234);
  });
});

// 성능 측정 래퍼 테스트
describe('Performance Wrapper', () => {
  it('should measure execution time', async () => {
    const start = Date.now();

    // 시뮬레이션된 비동기 작업
    await new Promise(resolve => setTimeout(resolve, 50));

    const duration = Date.now() - start;

    expect(duration).toBeGreaterThanOrEqual(50);
    expect(duration).toBeLessThan(200); // 너무 오래 걸리면 안됨
  });

  it('should capture errors in wrapped functions', async () => {
    const wrappedFn = async <T>(fn: () => Promise<T>): Promise<{ result?: T; error?: string; duration: number }> => {
      const start = Date.now();
      try {
        const result = await fn();
        return { result, duration: Date.now() - start };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e), duration: Date.now() - start };
      }
    };

    const successResult = await wrappedFn(async () => 'success');
    expect(successResult.result).toBe('success');
    expect(successResult.error).toBeUndefined();

    const errorResult = await wrappedFn(async () => {
      throw new Error('Test error');
    });
    expect(errorResult.error).toBe('Test error');
    expect(errorResult.result).toBeUndefined();
  });
});
