import type { Tool, CallToolResult } from '../types.js';
export declare const projectTools: Tool[];
export declare function listProjects(): Promise<CallToolResult>;
export declare function getSession(project: string, includeRaw?: boolean, maxContentLength?: number): Promise<CallToolResult>;
export declare function updateSession(project: string, lastWork: string, currentStatus?: string, nextTasks?: string[], modifiedFiles?: string[], issues?: string[], verificationResult?: string): Promise<CallToolResult>;
export declare function getTechStack(project: string): Promise<CallToolResult>;
export declare function runVerification(project: string, gates?: string[]): Promise<CallToolResult>;
export declare function detectPlatform(project: string): Promise<CallToolResult>;
export declare function getProjectStats(project?: string): CallToolResult;
