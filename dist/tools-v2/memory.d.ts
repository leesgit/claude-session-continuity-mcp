import type { Tool, CallToolResult } from '../types.js';
export declare const memoryTools: Tool[];
export declare function handleMemoryStore(args: unknown): Promise<CallToolResult>;
export declare function handleMemorySearch(args: unknown): Promise<CallToolResult>;
export declare function handleMemoryDelete(args: unknown): Promise<CallToolResult>;
export declare function handleMemoryStats(): Promise<CallToolResult>;
