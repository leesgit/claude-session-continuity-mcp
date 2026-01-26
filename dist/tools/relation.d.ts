import type { Tool, CallToolResult } from '../types.js';
export declare const relationTools: Tool[];
export declare function createRelation(sourceId: number, targetId: number, relationType: string, strength?: number): CallToolResult;
export declare function findConnectedMemories(memoryId: number, depth?: number, relationType?: string): CallToolResult;
