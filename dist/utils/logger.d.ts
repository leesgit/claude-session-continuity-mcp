export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
declare class Logger {
    private level;
    private logFile;
    constructor();
    private shouldLog;
    private maskSensitive;
    private formatEntry;
    private write;
    debug(message: string, data?: Record<string, unknown>, tool?: string): void;
    info(message: string, data?: Record<string, unknown>, tool?: string): void;
    warn(message: string, data?: Record<string, unknown>, tool?: string): void;
    error(message: string, data?: Record<string, unknown>, tool?: string): void;
    withTool<T>(toolName: string, fn: () => Promise<T>, args?: Record<string, unknown>): Promise<T>;
}
export declare const logger: Logger;
export {};
