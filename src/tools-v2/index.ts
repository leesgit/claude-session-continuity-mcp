// 통합 도구 v2 - 15개 도구
// 기존 46개 도구를 15개로 통합 (자동 컨텍스트 캡처 3개 추가)

import { contextTools, handleContextGet, handleContextUpdate } from './context.js';
import { memoryTools, handleMemoryStore, handleMemorySearch, handleMemoryDelete, handleMemoryStats } from './memory.js';
import { taskTools, handleTaskManage } from './task.js';
import { verifyTools, handleVerify } from './verify.js';
import { learnTools, handleLearn, handleRecallSolution } from './learn.js';
import { projectsTools, handleProjects } from './projects.js';
import { embeddingTools, handleRebuildEmbeddings } from './embedding.js';
import { autoCaptureTools, handleSessionStart, handleSessionEnd, handleSessionSummary } from './auto-capture.js';

import type { Tool, CallToolResult } from '../types.js';

// 모든 도구 정의 (15개)
export const allToolsV2: Tool[] = [
  ...contextTools,      // context_get, context_update
  ...memoryTools,       // memory_store, memory_search, memory_delete, memory_stats
  ...taskTools,         // task_manage
  ...verifyTools,       // verify
  ...learnTools,        // learn, recall_solution
  ...projectsTools,     // projects
  ...embeddingTools,    // rebuild_embeddings
  ...autoCaptureTools   // session_start, session_end, session_summary
];

// 도구 핸들러 라우터
export async function handleToolV2(name: string, args: unknown): Promise<CallToolResult> {
  switch (name) {
    // Context
    case 'context_get':
      return handleContextGet(args);
    case 'context_update':
      return handleContextUpdate(args);

    // Memory
    case 'memory_store':
      return handleMemoryStore(args);
    case 'memory_search':
      return handleMemorySearch(args);
    case 'memory_delete':
      return handleMemoryDelete(args);
    case 'memory_stats':
      return handleMemoryStats();

    // Task
    case 'task_manage':
      return handleTaskManage(args);

    // Verify
    case 'verify':
      return handleVerify(args);

    // Learn
    case 'learn':
      return handleLearn(args);
    case 'recall_solution':
      return handleRecallSolution(args);

    // Projects
    case 'projects':
      return handleProjects(args);

    // Embedding
    case 'rebuild_embeddings':
      return handleRebuildEmbeddings(args);

    // Auto Capture (Session Lifecycle)
    case 'session_start':
      return handleSessionStart(args);
    case 'session_end':
      return handleSessionEnd(args);
    case 'session_summary':
      return handleSessionSummary(args);

    default:
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true
      };
  }
}

// 도구 이름 목록
export const toolNamesV2 = allToolsV2.map(t => t.name);

// Export individual handlers for testing
export {
  handleContextGet,
  handleContextUpdate,
  handleMemoryStore,
  handleMemorySearch,
  handleMemoryDelete,
  handleMemoryStats,
  handleTaskManage,
  handleVerify,
  handleLearn,
  handleRecallSolution,
  handleProjects,
  handleRebuildEmbeddings,
  handleSessionStart,
  handleSessionEnd,
  handleSessionSummary
};
