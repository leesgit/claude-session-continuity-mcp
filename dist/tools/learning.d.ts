import type { Tool, CallToolResult, AutoLearnDecisionArgs, AutoLearnFixArgs, AutoLearnPatternArgs, AutoLearnDependencyArgs } from '../types.js';
export declare const learningTools: Tool[];
export declare function autoLearnDecision(args: AutoLearnDecisionArgs): Promise<CallToolResult>;
export declare function autoLearnFix(args: AutoLearnFixArgs): Promise<CallToolResult>;
export declare function autoLearnPattern(args: AutoLearnPatternArgs): Promise<CallToolResult>;
export declare function autoLearnDependency(args: AutoLearnDependencyArgs): Promise<CallToolResult>;
export declare function getProjectKnowledge(project: string, knowledgeType?: string, limit?: number): CallToolResult;
export declare function getSimilarIssues(errorOrIssue: string, project?: string, limit?: number): Promise<CallToolResult>;
