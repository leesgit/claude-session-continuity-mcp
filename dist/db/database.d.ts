import { Database as DatabaseType } from 'better-sqlite3';
import type { ContentFilterPattern } from '../types.js';
export declare const WORKSPACE_ROOT: string;
export declare const APPS_DIR: string;
export declare const db: DatabaseType;
export declare let contentFilterPatterns: ContentFilterPattern[];
export declare function initDatabase(): void;
export declare function loadContentFilterPatterns(): void;
