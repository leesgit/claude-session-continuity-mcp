import type { Tool, CallToolResult } from '../types.js';
export declare const contextTools: Tool[];
export declare function handleContextGet(args: unknown): Promise<CallToolResult>;
export declare function handleContextUpdate(args: unknown): Promise<CallToolResult>;
