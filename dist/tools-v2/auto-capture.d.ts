import type { Tool, CallToolResult } from '../types.js';
export declare const autoCaptureTools: Tool[];
export declare function handleSessionStart(args: unknown): Promise<CallToolResult>;
export declare function handleSessionEnd(args: unknown): Promise<CallToolResult>;
export declare function handleSessionSummary(args: unknown): Promise<CallToolResult>;
