import type { Tool, CallToolResult } from '../types.js';
export declare const sessionTools: Tool[];
export declare function saveSessionHistory(project: string, lastWork: string, currentStatus?: string, nextTasks?: string[], modifiedFiles?: string[], issues?: string[], verificationResult?: string, durationMinutes?: number): CallToolResult;
export declare function getSessionHistory(project?: string, limit?: number, keyword?: string): CallToolResult;
export declare function searchSimilarWork(keyword: string, project?: string): CallToolResult;
export declare function recordWorkPattern(project: string, workType: string, description: string, filesPattern?: string, success?: boolean, durationMinutes?: number): CallToolResult;
export declare function getWorkPatterns(project?: string, workType?: string): CallToolResult;
