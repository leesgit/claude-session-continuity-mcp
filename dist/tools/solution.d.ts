import type { Tool, CallToolResult } from '../types.js';
export declare const solutionTools: Tool[];
export declare function recordSolution(errorSignature: string, solution: string, project?: string, errorMessage?: string, relatedFiles?: string[]): CallToolResult;
export declare function findSolution(errorText: string, project?: string): CallToolResult;
export declare function getContinuityStats(project?: string): CallToolResult;
