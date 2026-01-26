import type { Tool, CallToolResult } from '../types.js';
export declare const embeddingTools: Tool[];
export declare function handleRebuildEmbeddings(args: unknown): Promise<CallToolResult>;
