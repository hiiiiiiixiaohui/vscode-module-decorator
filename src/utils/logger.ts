import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('UmiJS Router Module Analyzer');
        this.logLevel = this.getConfiguredLogLevel();
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    private getConfiguredLogLevel(): LogLevel {
        const config = vscode.workspace.getConfiguration('extensionmodulemap');
        const level = config.get<string>('logLevel', 'info').toLowerCase();
        
        switch (level) {
            case 'debug': return LogLevel.DEBUG;
            case 'info': return LogLevel.INFO;
            case 'warn': return LogLevel.WARN;
            case 'error': return LogLevel.ERROR;
            default: return LogLevel.INFO;
        }
    }

    private shouldLog(level: LogLevel): boolean {
        return level >= this.logLevel;
    }

    private formatMessage(level: string, message: string, context?: any): string {
        const timestamp = new Date().toISOString();
        const contextStr = context ? ` | Context: ${JSON.stringify(context)}` : '';
        return `[${timestamp}] [${level}] ${message}${contextStr}`;
    }

    public debug(message: string, context?: any): void {
        if (this.shouldLog(LogLevel.DEBUG)) {
            const formattedMessage = this.formatMessage('DEBUG', message, context);
            this.outputChannel.appendLine(formattedMessage);
            console.debug(formattedMessage);
        }
    }

    public info(message: string, context?: any): void {
        if (this.shouldLog(LogLevel.INFO)) {
            const formattedMessage = this.formatMessage('INFO', message, context);
            this.outputChannel.appendLine(formattedMessage);
            console.info(formattedMessage);
        }
    }

    public warn(message: string, context?: any): void {
        if (this.shouldLog(LogLevel.WARN)) {
            const formattedMessage = this.formatMessage('WARN', message, context);
            this.outputChannel.appendLine(formattedMessage);
            console.warn(formattedMessage);
        }
    }

    public error(message: string, error?: Error, context?: any): void {
        if (this.shouldLog(LogLevel.ERROR)) {
            const errorDetails = error ? ` | Error: ${error.message} | Stack: ${error.stack}` : '';
            const formattedMessage = this.formatMessage('ERROR', message + errorDetails, context);
            this.outputChannel.appendLine(formattedMessage);
            console.error(formattedMessage);
        }
    }

    public show(): void {
        this.outputChannel.show();
    }

    public clear(): void {
        this.outputChannel.clear();
    }

    public dispose(): void {
        this.outputChannel.dispose();
    }
}

/**
 * 错误处理装饰器
 * @param target 目标类
 * @param propertyKey 方法名
 * @param descriptor 方法描述符
 */
export function handleErrors(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const logger = Logger.getInstance();

    descriptor.value = async function (...args: any[]) {
        try {
            return await originalMethod.apply(this, args);
        } catch (error) {
            logger.error(`Error in ${target.constructor.name}.${propertyKey}`, error as Error, { args });
            throw error;
        }
    };

    return descriptor;
}

/**
 * 性能监控装饰器
 * @param target 目标类
 * @param propertyKey 方法名
 * @param descriptor 方法描述符
 */
export function measurePerformance(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const logger = Logger.getInstance();

    descriptor.value = async function (...args: any[]) {
        const startTime = Date.now();
        try {
            const result = await originalMethod.apply(this, args);
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            if (duration > 1000) { // 只记录超过1秒的操作
                logger.warn(`Slow operation detected: ${target.constructor.name}.${propertyKey} took ${duration}ms`);
            } else {
                logger.debug(`${target.constructor.name}.${propertyKey} completed in ${duration}ms`);
            }
            
            return result;
        } catch (error) {
            const endTime = Date.now();
            const duration = endTime - startTime;
            logger.error(`${target.constructor.name}.${propertyKey} failed after ${duration}ms`, error as Error);
            throw error;
        }
    };

    return descriptor;
}

/**
 * 创建带有重试机制的异步函数
 * @param fn 要执行的函数
 * @param maxRetries 最大重试次数
 * @param delay 重试延迟（毫秒）
 * @returns 包装后的函数
 */
export function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
): () => Promise<T> {
    const logger = Logger.getInstance();
    
    return async (): Promise<T> => {
        let lastError: Error;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error as Error;
                logger.warn(`Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
                
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, delay * attempt));
                }
            }
        }
        
        logger.error(`All ${maxRetries} attempts failed`, lastError!);
        throw lastError!;
    };
}
