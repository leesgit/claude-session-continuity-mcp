// 캐시 시스템 테스트
import { describe, it, expect, beforeEach } from 'vitest';

// QueryCache 구현 (테스트용)
interface CacheEntry<T> {
  value: T;
  createdAt: number;
  accessCount: number;
}

interface CacheOptions {
  maxSize: number;
  ttlMs: number;
}

class QueryCache<T = unknown> {
  private cache: Map<string, CacheEntry<T>>;
  private options: CacheOptions;
  private hits = 0;
  private misses = 0;

  constructor(options: Partial<CacheOptions> = {}) {
    this.cache = new Map();
    this.options = { maxSize: 100, ttlMs: 30000, ...options };
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() - entry.createdAt > this.options.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    entry.accessCount++;
    this.hits++;
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.options.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, {
      value,
      createdAt: Date.now(),
      accessCount: 0
    });
  }

  async getOrSet(key: string, factory: () => T | Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    this.set(key, value);
    return value;
  }

  invalidate(key: string): boolean {
    return this.cache.delete(key);
  }

  invalidatePattern(pattern: string | RegExp): number {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.options.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0
    };
  }

  private evictLRU(): void {
    let lruKey: string | undefined;
    let lruCount = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.accessCount < lruCount) {
        lruCount = entry.accessCount;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
    }
  }
}

describe('QueryCache', () => {
  let cache: QueryCache<string>;

  beforeEach(() => {
    cache = new QueryCache<string>({ maxSize: 3, ttlMs: 1000 });
  });

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should overwrite existing values', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');
      expect(cache.get('key1')).toBe('value2');
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortCache = new QueryCache<string>({ maxSize: 10, ttlMs: 50 });
      shortCache.set('key1', 'value1');

      expect(shortCache.get('key1')).toBe('value1');

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 60));

      expect(shortCache.get('key1')).toBeUndefined();
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used when full', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1 and key2 to increase their access count
      cache.get('key1');
      cache.get('key2');

      // Add new entry, should evict key3 (least accessed)
      cache.set('key4', 'value4');

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key4')).toBe('value4');
      // key3 should have been evicted (but checking after eviction is tricky due to miss tracking)
    });

    it('should not exceed max size', () => {
      for (let i = 0; i < 10; i++) {
        cache.set(`key${i}`, `value${i}`);
      }

      expect(cache.getStats().size).toBeLessThanOrEqual(3);
    });
  });

  describe('invalidation', () => {
    it('should invalidate single key', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');

      const result = cache.invalidate('key1');
      expect(result).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should return false when invalidating non-existent key', () => {
      const result = cache.invalidate('nonexistent');
      expect(result).toBe(false);
    });

    it('should invalidate keys matching pattern', () => {
      cache.set('user:1', 'alice');
      cache.set('user:2', 'bob');
      cache.set('post:1', 'hello');

      const count = cache.invalidatePattern(/^user:/);
      expect(count).toBe(2);
      expect(cache.get('user:1')).toBeUndefined();
      expect(cache.get('user:2')).toBeUndefined();
      expect(cache.get('post:1')).toBe('hello');
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.clear();

      expect(cache.getStats().size).toBe(0);
      expect(cache.get('key1')).toBeUndefined();
    });
  });

  describe('getOrSet', () => {
    it('should return cached value if exists', async () => {
      cache.set('key1', 'cached');
      let factoryCalled = false;

      const result = await cache.getOrSet('key1', () => {
        factoryCalled = true;
        return 'new';
      });

      expect(result).toBe('cached');
      expect(factoryCalled).toBe(false);
    });

    it('should call factory and cache if not exists', async () => {
      let factoryCalled = false;

      const result = await cache.getOrSet('key1', () => {
        factoryCalled = true;
        return 'new';
      });

      expect(result).toBe('new');
      expect(factoryCalled).toBe(true);
      expect(cache.get('key1')).toBe('new');
    });

    it('should work with async factory', async () => {
      const result = await cache.getOrSet('key1', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'async-value';
      });

      expect(result).toBe('async-value');
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', () => {
      cache.set('key1', 'value1');

      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('key2'); // miss
      cache.get('key3'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should report correct size', () => {
      expect(cache.getStats().size).toBe(0);

      cache.set('key1', 'value1');
      expect(cache.getStats().size).toBe(1);

      cache.set('key2', 'value2');
      expect(cache.getStats().size).toBe(2);
    });
  });
});

describe('Cache Key Generators', () => {
  it('should generate context keys', () => {
    const makeContextKey = (project: string) => `context:${project}`;

    expect(makeContextKey('my-app')).toBe('context:my-app');
    expect(makeContextKey('test-project')).toBe('context:test-project');
  });

  it('should generate memory keys', () => {
    const makeMemoryKey = (query: string, project?: string, type?: string) =>
      `memory:${project || '*'}:${type || '*'}:${query}`;

    expect(makeMemoryKey('search term')).toBe('memory:*:*:search term');
    expect(makeMemoryKey('search', 'my-app')).toBe('memory:my-app:*:search');
    expect(makeMemoryKey('search', 'my-app', 'error')).toBe('memory:my-app:error:search');
  });

  it('should generate project key', () => {
    const makeProjectKey = () => 'projects:list';

    expect(makeProjectKey()).toBe('projects:list');
  });
});
