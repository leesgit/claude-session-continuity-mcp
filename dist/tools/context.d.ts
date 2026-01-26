import type { Tool, CallToolResult } from '../types.js';
export declare const contextTools: Tool[];
export declare function getProjectContext(project: string): Promise<CallToolResult>;
export declare function updateActiveContext(project: string, currentState: string, recentFiles?: string[], blockers?: string, lastVerification?: string): CallToolResult;
export declare function initProjectContext(project: string, techStack?: Record<string, unknown>, architectureDecisions?: string[], codePatterns?: string[], specialNotes?: string): Promise<CallToolResult>;
export declare function updateArchitectureDecision(project: string, decision: string): CallToolResult;
