interface CacheOptions {
    maxSize: number;
    ttlMs: number;
}
export declare class QueryCache<T = unknown> {
    private cache;
    private options;
    private hits;
    private misses;
    constructor(options?: Partial<CacheOptions>);
    /**
     * 캐시에서 값 조회
     * @returns 캐시된 값 또는 undefined
     */
    get(key: string): T | undefined;
    /**
     * 캐시에 값 저장
     */
    set(key: string, value: T): void;
    /**
     * 캐시에서 값 조회 또는 생성
     */
    getOrSet(key: string, factory: () => T | Promise<T>): Promise<T>;
    /**
     * 특정 키 무효화
     */
    invalidate(key: string): boolean;
    /**
     * 패턴과 일치하는 모든 키 무효화
     */
    invalidatePattern(pattern: string | RegExp): number;
    /**
     * 전체 캐시 초기화
     */
    clear(): void;
    /**
     * 캐시 통계
     */
    getStats(): {
        size: number;
        maxSize: number;
        hits: number;
        misses: number;
        hitRate: number;
    };
    /**
     * LRU 항목 제거
     */
    private evictLRU;
}
export declare const contextCache: QueryCache<unknown>;
export declare const memoryCache: QueryCache<unknown>;
export declare const projectCache: QueryCache<unknown>;
export declare function makeContextKey(project: string): string;
export declare function makeMemoryKey(query: string, project?: string, type?: string): string;
export declare function makeProjectKey(): string;
export declare function invalidateContext(project: string): void;
export declare function invalidateMemory(project?: string): void;
export declare function invalidateProjects(): void;
export {};
