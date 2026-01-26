export interface ProjectContext {
    project: string;
    fixed: {
        techStack: Record<string, string>;
        architectureDecisions: string[];
        codePatterns: string[];
        specialNotes: string | null;
    };
    active: {
        currentState: string;
        recentFiles: string[];
        blockers: string | null;
        lastVerification: string | null;
        updatedAt: string | null;
    };
    pendingTasks: Array<{
        id: number;
        title: string;
        status: string;
        priority: number;
    }>;
}
export interface ContextSnapshot {
    project: string;
    timestamp: string;
    tokenEstimate: number;
    context: ProjectContext;
}
/**
 * 컨텍스트의 총 토큰 수 추정
 */
export declare function estimateContextTokens(context: ProjectContext): number;
/**
 * 프로젝트 컨텍스트 자동 로드 (캐시 우선)
 * 목표: < 5ms (캐시 히트 시)
 */
export declare function loadContext(project: string): Promise<ProjectContext>;
export interface SaveContextOptions {
    currentState: string;
    recentFiles?: string[];
    blockers?: string | null;
    verification?: 'passed' | 'failed' | null;
    architectureDecision?: string;
    codePattern?: string;
    techStack?: Record<string, string>;
}
/**
 * 프로젝트 컨텍스트 자동 저장
 */
export declare function saveContext(project: string, options: SaveContextOptions): Promise<void>;
/**
 * 현재 컨텍스트의 스냅샷 생성 (토큰 추정 포함)
 */
export declare function createContextSnapshot(project: string): Promise<ContextSnapshot>;
/**
 * 토큰 효율적 컨텍스트 요약 (650토큰 목표)
 */
export declare function getCompactContext(project: string): Promise<string>;
