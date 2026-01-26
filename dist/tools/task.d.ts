import type { Tool, CallToolResult } from '../types.js';
export declare const taskTools: Tool[];
export declare function addTask(project: string, title: string, description?: string, priority?: number, relatedFiles?: string[], acceptanceCriteria?: string): CallToolResult;
export declare function completeTask(taskId: number): CallToolResult;
export declare function updateTaskStatus(taskId: number, status: string): CallToolResult;
export declare function getPendingTasks(project: string, includeBlocked?: boolean): CallToolResult;
