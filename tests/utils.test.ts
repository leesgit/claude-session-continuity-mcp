// 유틸리티 함수 테스트
import { describe, it, expect } from 'vitest';

// 파일 경로 유틸리티
describe('File Path Utilities', () => {
  it('should extract file extension', () => {
    const getExtension = (filename: string): string => {
      const parts = filename.split('.');
      return parts.length > 1 ? parts.pop()! : '';
    };

    expect(getExtension('file.ts')).toBe('ts');
    expect(getExtension('file.test.ts')).toBe('ts');
    expect(getExtension('file')).toBe('');
    expect(getExtension('.gitignore')).toBe('gitignore');
  });

  it('should get filename from path', () => {
    const getFilename = (path: string): string => {
      return path.split('/').pop() || '';
    };

    expect(getFilename('/path/to/file.ts')).toBe('file.ts');
    expect(getFilename('file.ts')).toBe('file.ts');
    expect(getFilename('/path/')).toBe('');
  });

  it('should normalize path separators', () => {
    const normalizePath = (path: string): string => {
      return path.replace(/\\/g, '/');
    };

    expect(normalizePath('path\\to\\file')).toBe('path/to/file');
    expect(normalizePath('path/to/file')).toBe('path/to/file');
  });
});

// 문자열 유틸리티
describe('String Utilities', () => {
  it('should truncate long strings', () => {
    const truncate = (str: string, maxLength: number): string => {
      return str.length > maxLength ? str.slice(0, maxLength) + '...' : str;
    };

    expect(truncate('short', 10)).toBe('short');
    expect(truncate('this is a long string', 10)).toBe('this is a ...');
  });

  it('should generate slug from string', () => {
    const slugify = (str: string): string => {
      return str
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]+/g, '-')
        .replace(/^-|-$/g, '');
    };

    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('Test Project 123')).toBe('test-project-123');
    expect(slugify('한글 테스트')).toBe('한글-테스트');
  });

  it('should extract keywords from text', () => {
    const extractKeywords = (text: string, minLength: number = 3): string[] => {
      return text
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length >= minLength)
        .filter((word, index, self) => self.indexOf(word) === index);
    };

    expect(extractKeywords('The quick brown fox')).toEqual(['the', 'quick', 'brown', 'fox']);
    expect(extractKeywords('a is an')).toEqual([]);
  });
});

// 날짜 유틸리티
describe('Date Utilities', () => {
  it('should format ISO date', () => {
    const formatDate = (date: Date): string => {
      return date.toISOString();
    };

    const date = new Date('2024-01-15T12:00:00Z');
    expect(formatDate(date)).toBe('2024-01-15T12:00:00.000Z');
  });

  it('should calculate date difference in days', () => {
    const daysDiff = (date1: Date, date2: Date): number => {
      const diff = Math.abs(date2.getTime() - date1.getTime());
      return Math.floor(diff / (1000 * 60 * 60 * 24));
    };

    const date1 = new Date('2024-01-01');
    const date2 = new Date('2024-01-10');
    expect(daysDiff(date1, date2)).toBe(9);
  });

  it('should check if date is today', () => {
    const isToday = (date: Date): boolean => {
      const today = new Date();
      return date.toDateString() === today.toDateString();
    };

    expect(isToday(new Date())).toBe(true);
    expect(isToday(new Date('2020-01-01'))).toBe(false);
  });

  it('should get relative time description', () => {
    const getRelativeTime = (date: Date): string => {
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}분 전`;
      if (diffHours < 24) return `${diffHours}시간 전`;
      if (diffDays < 7) return `${diffDays}일 전`;
      return date.toLocaleDateString();
    };

    const now = new Date();
    expect(getRelativeTime(now)).toBe('just now');

    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);
    expect(getRelativeTime(fiveMinutesAgo)).toBe('5분 전');
  });
});

// 배열 유틸리티
describe('Array Utilities', () => {
  it('should chunk array', () => {
    const chunk = <T>(arr: T[], size: number): T[][] => {
      const chunks: T[][] = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    };

    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it('should remove duplicates', () => {
    const unique = <T>(arr: T[]): T[] => {
      return [...new Set(arr)];
    };

    expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
    expect(unique(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('should group by key', () => {
    const groupBy = <T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> => {
      return arr.reduce((acc, item) => {
        const key = keyFn(item);
        acc[key] = acc[key] || [];
        acc[key].push(item);
        return acc;
      }, {} as Record<string, T[]>);
    };

    const items = [
      { type: 'a', value: 1 },
      { type: 'b', value: 2 },
      { type: 'a', value: 3 }
    ];

    const grouped = groupBy(items, item => item.type);
    expect(grouped['a'].length).toBe(2);
    expect(grouped['b'].length).toBe(1);
  });

  it('should sort by multiple keys', () => {
    const sortByMultiple = <T>(arr: T[], ...comparators: ((a: T, b: T) => number)[]): T[] => {
      return [...arr].sort((a, b) => {
        for (const comparator of comparators) {
          const result = comparator(a, b);
          if (result !== 0) return result;
        }
        return 0;
      });
    };

    const items = [
      { priority: 1, name: 'b' },
      { priority: 2, name: 'a' },
      { priority: 1, name: 'a' }
    ];

    const sorted = sortByMultiple(
      items,
      (a, b) => b.priority - a.priority, // priority desc
      (a, b) => a.name.localeCompare(b.name) // name asc
    );

    expect(sorted[0]).toEqual({ priority: 2, name: 'a' });
    expect(sorted[1]).toEqual({ priority: 1, name: 'a' });
    expect(sorted[2]).toEqual({ priority: 1, name: 'b' });
  });
});

// JSON 유틸리티
describe('JSON Utilities', () => {
  it('should safely parse JSON', () => {
    const safeJsonParse = <T>(str: string, defaultValue: T): T => {
      try {
        return JSON.parse(str);
      } catch {
        return defaultValue;
      }
    };

    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
    expect(safeJsonParse('invalid', { default: true })).toEqual({ default: true });
  });

  it('should deep clone object', () => {
    const deepClone = <T>(obj: T): T => {
      return JSON.parse(JSON.stringify(obj));
    };

    const original = { a: 1, b: { c: 2 } };
    const cloned = deepClone(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.b).not.toBe(original.b);
  });

  it('should merge objects deeply', () => {
    const deepMerge = (target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> => {
      const result = { ...target };

      for (const key of Object.keys(source)) {
        if (
          source[key] &&
          typeof source[key] === 'object' &&
          !Array.isArray(source[key]) &&
          target[key] &&
          typeof target[key] === 'object' &&
          !Array.isArray(target[key])
        ) {
          result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
        } else {
          result[key] = source[key];
        }
      }

      return result;
    };

    const target = { a: 1, b: { c: 2, d: 3 } };
    const source = { b: { c: 10 }, e: 5 };
    const merged = deepMerge(target, source);

    expect(merged).toEqual({ a: 1, b: { c: 10, d: 3 }, e: 5 });
  });
});

// 에러 시그니처 유틸리티
describe('Error Signature Utilities', () => {
  it('should normalize error messages', () => {
    const normalizeError = (message: string): string => {
      return message
        .replace(/0x[a-f0-9]+/gi, 'ADDR') // 메모리 주소 일반화 (숫자 전에 해야 함)
        .replace(/\d+/g, 'N') // 숫자 일반화
        .replace(/['"][^'"]+['"]/g, 'STRING') // 문자열 리터럴 일반화
        .substring(0, 200);
    };

    expect(normalizeError('Error at line 42')).toContain('line N');
    expect(normalizeError('Memory at 0x7fff5fbff8c0')).toContain('ADDR');
    expect(normalizeError("Cannot find 'module-name'")).toContain('STRING');
  });

  it('should extract error type', () => {
    const extractErrorType = (message: string): string | null => {
      const match = message.match(/^(\w+Error):/);
      return match ? match[1] : null;
    };

    expect(extractErrorType('TypeError: Cannot read property')).toBe('TypeError');
    expect(extractErrorType('ReferenceError: x is not defined')).toBe('ReferenceError');
    expect(extractErrorType('Something went wrong')).toBeNull();
  });
});

// 플랫폼 감지 유틸리티
describe('Platform Detection', () => {
  it('should detect platform from files', () => {
    const detectPlatform = (files: string[]): string => {
      if (files.includes('pubspec.yaml')) return 'flutter';
      if (files.includes('build.gradle') || files.includes('build.gradle.kts')) return 'android';
      if (files.includes('Package.swift')) return 'ios';
      if (files.includes('package.json')) return 'node';
      return 'unknown';
    };

    expect(detectPlatform(['pubspec.yaml', 'lib/main.dart'])).toBe('flutter');
    expect(detectPlatform(['build.gradle', 'app/src'])).toBe('android');
    expect(detectPlatform(['package.json', 'src/index.ts'])).toBe('node');
    expect(detectPlatform(['README.md'])).toBe('unknown');
  });

  it('should detect framework from package.json', () => {
    const detectFramework = (dependencies: Record<string, string>): string => {
      if ('next' in dependencies) return 'nextjs';
      if ('react' in dependencies) return 'react';
      if ('vue' in dependencies) return 'vue';
      if ('@angular/core' in dependencies) return 'angular';
      if ('express' in dependencies) return 'express';
      return 'node';
    };

    expect(detectFramework({ next: '14.0.0', react: '18.0.0' })).toBe('nextjs');
    expect(detectFramework({ react: '18.0.0' })).toBe('react');
    expect(detectFramework({ vue: '3.0.0' })).toBe('vue');
    expect(detectFramework({ '@angular/core': '15.0.0' })).toBe('angular');
    expect(detectFramework({ lodash: '4.0.0' })).toBe('node');
  });
});
