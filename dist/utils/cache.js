// 쿼리 캐싱 시스템 - 5ms 읽기 목표
// LRU 캐시 + TTL 기반 무효화
const DEFAULT_OPTIONS = {
    maxSize: 100,
    ttlMs: 30000 // 30초
};
export class QueryCache {
    cache;
    options;
    hits = 0;
    misses = 0;
    constructor(options = {}) {
        this.cache = new Map();
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }
    /**
     * 캐시에서 값 조회
     * @returns 캐시된 값 또는 undefined
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return undefined;
        }
        // TTL 체크
        if (Date.now() - entry.createdAt > this.options.ttlMs) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }
        // 접근 횟수 증가
        entry.accessCount++;
        this.hits++;
        return entry.value;
    }
    /**
     * 캐시에 값 저장
     */
    set(key, value) {
        // 최대 크기 초과 시 LRU 제거
        if (this.cache.size >= this.options.maxSize) {
            this.evictLRU();
        }
        this.cache.set(key, {
            value,
            createdAt: Date.now(),
            accessCount: 0
        });
    }
    /**
     * 캐시에서 값 조회 또는 생성
     */
    async getOrSet(key, factory) {
        const cached = this.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const value = await factory();
        this.set(key, value);
        return value;
    }
    /**
     * 특정 키 무효화
     */
    invalidate(key) {
        return this.cache.delete(key);
    }
    /**
     * 패턴과 일치하는 모든 키 무효화
     */
    invalidatePattern(pattern) {
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
    /**
     * 전체 캐시 초기화
     */
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }
    /**
     * 캐시 통계
     */
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
    /**
     * LRU 항목 제거
     */
    evictLRU() {
        let lruKey;
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
// ===== 전역 캐시 인스턴스 =====
// 컨텍스트 캐시 (자주 조회)
export const contextCache = new QueryCache({
    maxSize: 50,
    ttlMs: 60000 // 1분
});
// 메모리 검색 캐시
export const memoryCache = new QueryCache({
    maxSize: 100,
    ttlMs: 30000 // 30초
});
// 프로젝트 목록 캐시
export const projectCache = new QueryCache({
    maxSize: 20,
    ttlMs: 120000 // 2분
});
// ===== 캐시 키 생성 헬퍼 =====
export function makeContextKey(project) {
    return `context:${project}`;
}
export function makeMemoryKey(query, project, type) {
    return `memory:${project || '*'}:${type || '*'}:${query}`;
}
export function makeProjectKey() {
    return 'projects:list';
}
// ===== 캐시 무효화 트리거 =====
export function invalidateContext(project) {
    contextCache.invalidate(makeContextKey(project));
}
export function invalidateMemory(project) {
    if (project) {
        memoryCache.invalidatePattern(`memory:${project}:`);
    }
    else {
        memoryCache.clear();
    }
}
export function invalidateProjects() {
    projectCache.invalidate(makeProjectKey());
}
