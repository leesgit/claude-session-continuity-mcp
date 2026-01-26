import type { Tool, CallToolResult } from '../types.js';
export declare const learnTools: Tool[];
export declare function handleLearn(args: unknown): Promise<CallToolResult>;
export declare function handleRecallSolution(args: unknown): Promise<CallToolResult>;
