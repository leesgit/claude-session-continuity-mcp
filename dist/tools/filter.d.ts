import type { Tool, CallToolResult } from '../types.js';
export declare const filterTools: Tool[];
export declare function recordFilterPattern(patternType: string, patternDescription: string, fileExtension?: string, exampleContext?: string, mitigationStrategy?: string): CallToolResult;
export declare function getFilterPatterns(patternType?: string, fileExtension?: string): CallToolResult;
export declare function getSafeOutputGuidelines(context?: string): CallToolResult;
