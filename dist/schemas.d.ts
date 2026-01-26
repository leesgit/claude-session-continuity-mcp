import { z } from 'zod';
export declare const ProjectNameSchema: z.ZodString;
export declare const MemoryTypeSchema: z.ZodEnum<["observation", "decision", "learning", "error", "pattern", "preference"]>;
export declare const TaskStatusSchema: z.ZodEnum<["pending", "in_progress", "done", "blocked"]>;
export declare const VerificationGateSchema: z.ZodEnum<["build", "test", "lint"]>;
export declare const ContextGetSchema: z.ZodObject<{
    project: z.ZodString;
}, "strip", z.ZodTypeAny, {
    project: string;
}, {
    project: string;
}>;
export declare const ContextUpdateSchema: z.ZodObject<{
    project: z.ZodString;
    currentState: z.ZodString;
    recentFiles: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    blockers: z.ZodOptional<z.ZodString>;
    verification: z.ZodOptional<z.ZodEnum<["passed", "failed"]>>;
    architectureDecision: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    project: string;
    currentState: string;
    verification?: "passed" | "failed" | undefined;
    recentFiles?: string[] | undefined;
    blockers?: string | undefined;
    architectureDecision?: string | undefined;
}, {
    project: string;
    currentState: string;
    verification?: "passed" | "failed" | undefined;
    recentFiles?: string[] | undefined;
    blockers?: string | undefined;
    architectureDecision?: string | undefined;
}>;
export declare const MemoryStoreSchema: z.ZodObject<{
    content: z.ZodString;
    type: z.ZodEnum<["observation", "decision", "learning", "error", "pattern", "preference"]>;
    project: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    importance: z.ZodDefault<z.ZodNumber>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    type: "error" | "observation" | "decision" | "learning" | "pattern" | "preference";
    content: string;
    importance: number;
    project?: string | undefined;
    tags?: string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    type: "error" | "observation" | "decision" | "learning" | "pattern" | "preference";
    content: string;
    project?: string | undefined;
    tags?: string[] | undefined;
    importance?: number | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
export declare const MemorySearchSchema: z.ZodObject<{
    query: z.ZodString;
    type: z.ZodOptional<z.ZodEnum<["observation", "decision", "learning", "error", "pattern", "preference"]>>;
    project: z.ZodOptional<z.ZodString>;
    semantic: z.ZodDefault<z.ZodBoolean>;
    limit: z.ZodDefault<z.ZodNumber>;
    minImportance: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    query: string;
    minImportance: number;
    semantic: boolean;
    project?: string | undefined;
    type?: "error" | "observation" | "decision" | "learning" | "pattern" | "preference" | undefined;
}, {
    query: string;
    project?: string | undefined;
    type?: "error" | "observation" | "decision" | "learning" | "pattern" | "preference" | undefined;
    limit?: number | undefined;
    minImportance?: number | undefined;
    semantic?: boolean | undefined;
}>;
export declare const MemoryDeleteSchema: z.ZodObject<{
    id: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: number;
}, {
    id: number;
}>;
export declare const TaskManageSchema: z.ZodObject<{
    action: z.ZodEnum<["add", "complete", "update", "list"]>;
    project: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    priority: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    taskId: z.ZodOptional<z.ZodNumber>;
    status: z.ZodOptional<z.ZodEnum<["pending", "in_progress", "done", "blocked"]>>;
}, "strip", z.ZodTypeAny, {
    project: string;
    action: "update" | "list" | "add" | "complete";
    title?: string | undefined;
    status?: "pending" | "in_progress" | "done" | "blocked" | undefined;
    description?: string | undefined;
    taskId?: number | undefined;
    priority?: number | undefined;
}, {
    project: string;
    action: "update" | "list" | "add" | "complete";
    title?: string | undefined;
    status?: "pending" | "in_progress" | "done" | "blocked" | undefined;
    description?: string | undefined;
    taskId?: number | undefined;
    priority?: number | undefined;
}>;
export declare const VerifySchema: z.ZodObject<{
    project: z.ZodString;
    gates: z.ZodDefault<z.ZodArray<z.ZodEnum<["build", "test", "lint"]>, "many">>;
}, "strip", z.ZodTypeAny, {
    project: string;
    gates: ("build" | "test" | "lint")[];
}, {
    project: string;
    gates?: ("build" | "test" | "lint")[] | undefined;
}>;
export declare const LearnSchema: z.ZodObject<{
    project: z.ZodString;
    type: z.ZodEnum<["decision", "fix", "pattern", "dependency"]>;
    content: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
    files: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    alternatives: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    solution: z.ZodOptional<z.ZodString>;
    preventionTip: z.ZodOptional<z.ZodString>;
    example: z.ZodOptional<z.ZodString>;
    appliesTo: z.ZodOptional<z.ZodString>;
    dependency: z.ZodOptional<z.ZodString>;
    action: z.ZodOptional<z.ZodEnum<["add", "remove", "upgrade", "downgrade"]>>;
    fromVersion: z.ZodOptional<z.ZodString>;
    toVersion: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    project: string;
    type: "decision" | "pattern" | "dependency" | "fix";
    content: string;
    reason?: string | undefined;
    alternatives?: string[] | undefined;
    files?: string[] | undefined;
    solution?: string | undefined;
    preventionTip?: string | undefined;
    example?: string | undefined;
    appliesTo?: string | undefined;
    dependency?: string | undefined;
    action?: "add" | "remove" | "upgrade" | "downgrade" | undefined;
    fromVersion?: string | undefined;
    toVersion?: string | undefined;
}, {
    project: string;
    type: "decision" | "pattern" | "dependency" | "fix";
    content: string;
    reason?: string | undefined;
    alternatives?: string[] | undefined;
    files?: string[] | undefined;
    solution?: string | undefined;
    preventionTip?: string | undefined;
    example?: string | undefined;
    appliesTo?: string | undefined;
    dependency?: string | undefined;
    action?: "add" | "remove" | "upgrade" | "downgrade" | undefined;
    fromVersion?: string | undefined;
    toVersion?: string | undefined;
}>;
export declare const RecallSolutionSchema: z.ZodObject<{
    query: z.ZodString;
    project: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    query: string;
    project?: string | undefined;
}, {
    query: string;
    project?: string | undefined;
}>;
export declare const ProjectsSchema: z.ZodObject<{
    project: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    project?: string | undefined;
}, {
    project?: string | undefined;
}>;
export declare const ToolSchemas: {
    readonly context_get: z.ZodObject<{
        project: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        project: string;
    }, {
        project: string;
    }>;
    readonly context_update: z.ZodObject<{
        project: z.ZodString;
        currentState: z.ZodString;
        recentFiles: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        blockers: z.ZodOptional<z.ZodString>;
        verification: z.ZodOptional<z.ZodEnum<["passed", "failed"]>>;
        architectureDecision: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        project: string;
        currentState: string;
        verification?: "passed" | "failed" | undefined;
        recentFiles?: string[] | undefined;
        blockers?: string | undefined;
        architectureDecision?: string | undefined;
    }, {
        project: string;
        currentState: string;
        verification?: "passed" | "failed" | undefined;
        recentFiles?: string[] | undefined;
        blockers?: string | undefined;
        architectureDecision?: string | undefined;
    }>;
    readonly memory_store: z.ZodObject<{
        content: z.ZodString;
        type: z.ZodEnum<["observation", "decision", "learning", "error", "pattern", "preference"]>;
        project: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        importance: z.ZodDefault<z.ZodNumber>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        type: "error" | "observation" | "decision" | "learning" | "pattern" | "preference";
        content: string;
        importance: number;
        project?: string | undefined;
        tags?: string[] | undefined;
        metadata?: Record<string, unknown> | undefined;
    }, {
        type: "error" | "observation" | "decision" | "learning" | "pattern" | "preference";
        content: string;
        project?: string | undefined;
        tags?: string[] | undefined;
        importance?: number | undefined;
        metadata?: Record<string, unknown> | undefined;
    }>;
    readonly memory_search: z.ZodObject<{
        query: z.ZodString;
        type: z.ZodOptional<z.ZodEnum<["observation", "decision", "learning", "error", "pattern", "preference"]>>;
        project: z.ZodOptional<z.ZodString>;
        semantic: z.ZodDefault<z.ZodBoolean>;
        limit: z.ZodDefault<z.ZodNumber>;
        minImportance: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        limit: number;
        query: string;
        minImportance: number;
        semantic: boolean;
        project?: string | undefined;
        type?: "error" | "observation" | "decision" | "learning" | "pattern" | "preference" | undefined;
    }, {
        query: string;
        project?: string | undefined;
        type?: "error" | "observation" | "decision" | "learning" | "pattern" | "preference" | undefined;
        limit?: number | undefined;
        minImportance?: number | undefined;
        semantic?: boolean | undefined;
    }>;
    readonly memory_delete: z.ZodObject<{
        id: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: number;
    }, {
        id: number;
    }>;
    readonly memory_stats: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    readonly task_manage: z.ZodObject<{
        action: z.ZodEnum<["add", "complete", "update", "list"]>;
        project: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        priority: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        taskId: z.ZodOptional<z.ZodNumber>;
        status: z.ZodOptional<z.ZodEnum<["pending", "in_progress", "done", "blocked"]>>;
    }, "strip", z.ZodTypeAny, {
        project: string;
        action: "update" | "list" | "add" | "complete";
        title?: string | undefined;
        status?: "pending" | "in_progress" | "done" | "blocked" | undefined;
        description?: string | undefined;
        taskId?: number | undefined;
        priority?: number | undefined;
    }, {
        project: string;
        action: "update" | "list" | "add" | "complete";
        title?: string | undefined;
        status?: "pending" | "in_progress" | "done" | "blocked" | undefined;
        description?: string | undefined;
        taskId?: number | undefined;
        priority?: number | undefined;
    }>;
    readonly verify: z.ZodObject<{
        project: z.ZodString;
        gates: z.ZodDefault<z.ZodArray<z.ZodEnum<["build", "test", "lint"]>, "many">>;
    }, "strip", z.ZodTypeAny, {
        project: string;
        gates: ("build" | "test" | "lint")[];
    }, {
        project: string;
        gates?: ("build" | "test" | "lint")[] | undefined;
    }>;
    readonly learn: z.ZodObject<{
        project: z.ZodString;
        type: z.ZodEnum<["decision", "fix", "pattern", "dependency"]>;
        content: z.ZodString;
        reason: z.ZodOptional<z.ZodString>;
        files: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        alternatives: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        solution: z.ZodOptional<z.ZodString>;
        preventionTip: z.ZodOptional<z.ZodString>;
        example: z.ZodOptional<z.ZodString>;
        appliesTo: z.ZodOptional<z.ZodString>;
        dependency: z.ZodOptional<z.ZodString>;
        action: z.ZodOptional<z.ZodEnum<["add", "remove", "upgrade", "downgrade"]>>;
        fromVersion: z.ZodOptional<z.ZodString>;
        toVersion: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        project: string;
        type: "decision" | "pattern" | "dependency" | "fix";
        content: string;
        reason?: string | undefined;
        alternatives?: string[] | undefined;
        files?: string[] | undefined;
        solution?: string | undefined;
        preventionTip?: string | undefined;
        example?: string | undefined;
        appliesTo?: string | undefined;
        dependency?: string | undefined;
        action?: "add" | "remove" | "upgrade" | "downgrade" | undefined;
        fromVersion?: string | undefined;
        toVersion?: string | undefined;
    }, {
        project: string;
        type: "decision" | "pattern" | "dependency" | "fix";
        content: string;
        reason?: string | undefined;
        alternatives?: string[] | undefined;
        files?: string[] | undefined;
        solution?: string | undefined;
        preventionTip?: string | undefined;
        example?: string | undefined;
        appliesTo?: string | undefined;
        dependency?: string | undefined;
        action?: "add" | "remove" | "upgrade" | "downgrade" | undefined;
        fromVersion?: string | undefined;
        toVersion?: string | undefined;
    }>;
    readonly recall_solution: z.ZodObject<{
        query: z.ZodString;
        project: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        query: string;
        project?: string | undefined;
    }, {
        query: string;
        project?: string | undefined;
    }>;
    readonly projects: z.ZodObject<{
        project: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        project?: string | undefined;
    }, {
        project?: string | undefined;
    }>;
    readonly rebuild_embeddings: z.ZodObject<{
        force: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        force: boolean;
    }, {
        force?: boolean | undefined;
    }>;
};
export type ContextGetInput = z.infer<typeof ContextGetSchema>;
export type ContextUpdateInput = z.infer<typeof ContextUpdateSchema>;
export type MemoryStoreInput = z.infer<typeof MemoryStoreSchema>;
export type MemorySearchInput = z.infer<typeof MemorySearchSchema>;
export type MemoryDeleteInput = z.infer<typeof MemoryDeleteSchema>;
export type TaskManageInput = z.infer<typeof TaskManageSchema>;
export type VerifyInput = z.infer<typeof VerifySchema>;
export type LearnInput = z.infer<typeof LearnSchema>;
export type RecallSolutionInput = z.infer<typeof RecallSolutionSchema>;
export type ProjectsInput = z.infer<typeof ProjectsSchema>;
