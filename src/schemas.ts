// Zod 스키마 정의 - 입력 검증 및 타입 안전성
import { z } from 'zod';

// ===== 공통 스키마 =====

export const ProjectNameSchema = z.string().min(1).max(100).describe('프로젝트 이름');

export const MemoryTypeSchema = z.enum([
  'observation',  // 관찰
  'decision',     // 결정
  'learning',     // 학습
  'error',        // 에러
  'pattern',      // 패턴
  'preference'    // 선호
]).describe('메모리 유형');

export const TaskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'done',
  'blocked'
]).describe('태스크 상태');

export const VerificationGateSchema = z.enum([
  'build',
  'test',
  'lint'
]).describe('검증 게이트');

// ===== context 도구 스키마 =====

export const ContextGetSchema = z.object({
  project: ProjectNameSchema
}).describe('프로젝트 컨텍스트 조회');

export const ContextUpdateSchema = z.object({
  project: ProjectNameSchema,
  currentState: z.string().max(200).describe('현재 상태 (1줄 요약)'),
  recentFiles: z.array(z.string()).max(10).optional().describe('최근 수정 파일'),
  blockers: z.string().max(500).optional().describe('블로커/이슈'),
  verification: z.enum(['passed', 'failed']).optional().describe('마지막 검증 결과'),
  architectureDecision: z.string().max(200).optional().describe('추가할 아키텍처 결정')
}).describe('프로젝트 컨텍스트 업데이트');

// ===== memory 도구 스키마 =====

export const MemoryStoreSchema = z.object({
  content: z.string().min(1).max(5000).describe('저장할 내용'),
  type: MemoryTypeSchema,
  project: ProjectNameSchema.optional(),
  tags: z.array(z.string().max(50)).max(10).optional().describe('태그 목록'),
  importance: z.number().min(1).max(10).default(5).describe('중요도 1-10'),
  metadata: z.record(z.unknown()).optional().describe('추가 메타데이터')
}).describe('메모리 저장');

export const MemorySearchSchema = z.object({
  query: z.string().min(1).max(500).describe('검색 쿼리'),
  type: MemoryTypeSchema.optional(),
  project: ProjectNameSchema.optional(),
  semantic: z.boolean().default(false).describe('시맨틱 검색 사용'),
  limit: z.number().min(1).max(50).default(10).describe('최대 결과 수'),
  minImportance: z.number().min(1).max(10).default(1).describe('최소 중요도')
}).describe('메모리 검색 (FTS 또는 시맨틱)');

export const MemoryDeleteSchema = z.object({
  id: z.number().int().positive().describe('삭제할 메모리 ID')
}).describe('메모리 삭제');

// ===== task 도구 스키마 =====

export const TaskManageSchema = z.object({
  action: z.enum(['add', 'complete', 'update', 'list']).describe('작업 유형'),
  project: ProjectNameSchema,
  // add 시 필요
  title: z.string().max(200).optional().describe('태스크 제목'),
  description: z.string().max(1000).optional().describe('태스크 설명'),
  priority: z.number().min(1).max(10).default(5).optional().describe('우선순위'),
  // update 시 필요
  taskId: z.number().int().positive().optional().describe('태스크 ID'),
  status: TaskStatusSchema.optional().describe('새 상태')
}).describe('태스크 관리 (추가/완료/업데이트/목록)');

// ===== verify 도구 스키마 =====

export const VerifySchema = z.object({
  project: ProjectNameSchema,
  gates: z.array(VerificationGateSchema).default(['build', 'test', 'lint']).describe('실행할 게이트')
}).describe('프로젝트 검증 (빌드/테스트/린트)');

// ===== learn 도구 스키마 =====

export const LearnSchema = z.object({
  project: ProjectNameSchema,
  type: z.enum(['decision', 'fix', 'pattern', 'dependency']).describe('학습 유형'),
  // 공통
  content: z.string().min(1).max(2000).describe('학습 내용'),
  reason: z.string().max(500).optional().describe('이유/원인'),
  files: z.array(z.string()).max(20).optional().describe('관련 파일'),
  // decision
  alternatives: z.array(z.string()).max(5).optional().describe('고려한 대안'),
  // fix
  solution: z.string().max(1000).optional().describe('해결 방법'),
  preventionTip: z.string().max(500).optional().describe('재발 방지 팁'),
  // pattern
  example: z.string().max(500).optional().describe('예시'),
  appliesTo: z.string().max(200).optional().describe('적용 대상'),
  // dependency
  dependency: z.string().max(100).optional().describe('의존성 이름'),
  action: z.enum(['add', 'remove', 'upgrade', 'downgrade']).optional(),
  fromVersion: z.string().max(50).optional(),
  toVersion: z.string().max(50).optional()
}).describe('자동 학습 (결정/수정/패턴/의존성)');

export const RecallSolutionSchema = z.object({
  query: z.string().min(1).max(500).describe('에러 메시지 또는 이슈'),
  project: ProjectNameSchema.optional()
}).describe('유사 이슈 해결 방법 검색');

// ===== projects 도구 스키마 =====

export const ProjectsSchema = z.object({
  project: ProjectNameSchema.optional().describe('특정 프로젝트 (없으면 전체)')
}).describe('프로젝트 목록 및 통계');

// ===== 통합 스키마 맵 =====

export const ToolSchemas = {
  context_get: ContextGetSchema,
  context_update: ContextUpdateSchema,
  memory_store: MemoryStoreSchema,
  memory_search: MemorySearchSchema,
  memory_delete: MemoryDeleteSchema,
  memory_stats: z.object({}).describe('메모리 통계'),
  task_manage: TaskManageSchema,
  verify: VerifySchema,
  learn: LearnSchema,
  recall_solution: RecallSolutionSchema,
  projects: ProjectsSchema,
  rebuild_embeddings: z.object({
    force: z.boolean().default(false).describe('전체 재생성')
  }).describe('임베딩 재생성')
} as const;

// 스키마 타입 추출
export type ContextGetInput = z.infer<typeof ContextGetSchema>;
export type ContextUpdateInput = z.infer<typeof ContextUpdateSchema>;
export type MemoryStoreInput = z.infer<typeof MemoryStoreSchema>;
export type MemorySearchInput = z.infer<typeof MemorySearchSchema>;
export type MemoryDeleteInput = z.infer<typeof MemoryDeleteSchema>;
export type TaskManageInput = z.infer<typeof TaskManageSchema>;
export type VerifyInput = z.infer<typeof VerifySchema>;
export type LearnInput = z.infer<typeof LearnSchema>;
export type RecallSolutionInput = z.infer<typeof RecallSolutionSchema>;
export type ProjectsInput = z.infer<typeof ProjectsSchema>;
