import type { CallToolResult as SDKCallToolResult } from '@modelcontextprotocol/sdk/types.js';
export interface Tool {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: Record<string, unknown>;
        required?: string[];
    };
}
export type CallToolResult = SDKCallToolResult;
export declare function textResult(text: string, isError?: boolean): CallToolResult;
export interface AutoLearnDecisionArgs {
    project: string;
    decision: string;
    reason: string;
    context?: string;
    alternatives?: string[];
    files?: string[];
}
export interface AutoLearnFixArgs {
    project: string;
    error: string;
    solution: string;
    cause?: string;
    files?: string[];
    preventionTip?: string;
}
export interface AutoLearnPatternArgs {
    project: string;
    patternName: string;
    description: string;
    example?: string;
    appliesTo?: string;
}
export interface AutoLearnDependencyArgs {
    project: string;
    dependency: string;
    action: 'add' | 'remove' | 'upgrade' | 'downgrade';
    reason: string;
    fromVersion?: string;
    toVersion?: string;
    breakingChanges?: string;
}
export interface ContentFilterPattern {
    id: number;
    patternType: string;
    patternDescription: string;
    fileExtension: string | null;
    mitigationStrategy: string | null;
}
