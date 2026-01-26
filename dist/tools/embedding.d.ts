import type { Tool, CallToolResult } from '../types.js';
export declare const embeddingTools: Tool[];
export declare function semanticSearch(query: string, limit?: number, minSimilarity?: number, memoryType?: string, project?: string): Promise<CallToolResult>;
export declare function rebuildEmbeddings(force?: boolean): Promise<CallToolResult>;
export declare function getEmbeddingStatus(): CallToolResult;
