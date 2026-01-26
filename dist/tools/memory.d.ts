import type { Tool, CallToolResult } from '../types.js';
export declare const memoryTools: Tool[];
export declare function storeMemory(content: string, memoryType: string, tags?: string[], project?: string, importance?: number, metadata?: Record<string, unknown>): Promise<CallToolResult>;
export declare function recallMemory(query: string, memoryType?: string, project?: string, limit?: number, minImportance?: number, maxContentLength?: number): CallToolResult;
export declare function recallByTimeframe(timeframe: string, memoryType?: string, project?: string, limit?: number): CallToolResult;
export declare function searchByTag(tags: string[], matchAll?: boolean, limit?: number): CallToolResult;
export declare function getMemoryStats(): CallToolResult;
export declare function deleteMemory(memoryId: number): CallToolResult;
