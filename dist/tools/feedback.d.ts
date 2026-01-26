import type { Tool, CallToolResult } from '../types.js';
export declare const feedbackTools: Tool[];
export declare function collectWorkFeedback(project: string, workSummary: string, feedbackType: string, verificationPassed: boolean, feedbackContent?: string, affectedTool?: string, duration?: number): CallToolResult;
export declare function getPendingFeedbacks(feedbackType?: string, limit?: number): CallToolResult;
export declare function resolveFeedback(feedbackId: number, resolution?: string): CallToolResult;
