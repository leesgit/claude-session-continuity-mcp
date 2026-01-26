export declare function fileExists(filePath: string): Promise<boolean>;
export declare function readFileContent(filePath: string): Promise<string | null>;
export declare function writeFileContent(filePath: string, content: string): Promise<void>;
export declare function parseMarkdownTable(content: string, tableName: string): Record<string, string>;
