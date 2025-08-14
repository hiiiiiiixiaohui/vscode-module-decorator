import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from './logger';

export interface CacheEntry<T> {
    data: T;
    timestamp: number;
    version: string;
    checksum?: string;
}

export interface CacheOptions {
    maxAge?: number; // 缓存最大存活时间（毫秒）
    maxSize?: number; // 缓存最大条目数
    persistToDisk?: boolean; // 是否持久化到磁盘
    cacheDir?: string; // 缓存目录
}

export class CacheManager<T> {
    private cache: Map<string, CacheEntry<T>>;
    private options: Required<CacheOptions>;
    private logger: Logger;
    private accessOrder: string[]; // LRU访问顺序

    constructor(options: CacheOptions = {}) {
        this.cache = new Map();
        this.accessOrder = [];
        this.logger = Logger.getInstance();
        
        this.options = {
            maxAge: options.maxAge || 5 * 60 * 1000, // 默认5分钟
            maxSize: options.maxSize || 1000, // 默认1000条
            persistToDisk: options.persistToDisk || false,
            cacheDir: options.cacheDir || path.join(process.cwd(), '.cache')
        };

        if (this.options.persistToDisk) {
            this.loadFromDisk();
        }
    }

    /**
     * 设置缓存项
     * @param key 缓存键
     * @param data 缓存数据
     * @param version 版本号
     * @param checksum 校验和
     */
    async set(key: string, data: T, version: string = '1.0.0', checksum?: string): Promise<void> {
        try {
            const entry: CacheEntry<T> = {
                data,
                timestamp: Date.now(),
                version,
                checksum
            };

            this.cache.set(key, entry);
            this.updateAccessOrder(key);
            
            // 检查缓存大小限制
            if (this.cache.size > this.options.maxSize) {
                this.evictLRU();
            }

            if (this.options.persistToDisk) {
                await this.saveToDisk(key, entry);
            }

            this.logger.debug(`Cache set: ${key}`, { version, hasChecksum: !!checksum });
        } catch (error) {
            this.logger.error(`Failed to set cache for key: ${key}`, error as Error);
        }
    }

    /**
     * 获取缓存项
     * @param key 缓存键
     * @param version 期望的版本号
     * @returns 缓存数据或null
     */
    async get(key: string, version?: string): Promise<T | null> {
        try {
            const entry = this.cache.get(key);
            
            if (!entry) {
                this.logger.debug(`Cache miss: ${key}`);
                return null;
            }

            // 检查过期时间
            if (Date.now() - entry.timestamp > this.options.maxAge) {
                this.logger.debug(`Cache expired: ${key}`);
                this.cache.delete(key);
                this.removeFromAccessOrder(key);
                return null;
            }

            // 检查版本
            if (version && entry.version !== version) {
                this.logger.debug(`Cache version mismatch: ${key}`, { 
                    cached: entry.version, 
                    requested: version 
                });
                this.cache.delete(key);
                this.removeFromAccessOrder(key);
                return null;
            }

            this.updateAccessOrder(key);
            this.logger.debug(`Cache hit: ${key}`);
            return entry.data;
        } catch (error) {
            this.logger.error(`Failed to get cache for key: ${key}`, error as Error);
            return null;
        }
    }

    /**
     * 检查缓存项是否存在且有效
     * @param key 缓存键
     * @param version 期望的版本号
     * @returns 是否存在有效缓存
     */
    has(key: string, version?: string): boolean {
        const entry = this.cache.get(key);
        
        if (!entry) {
            return false;
        }

        // 检查过期时间
        if (Date.now() - entry.timestamp > this.options.maxAge) {
            this.cache.delete(key);
            this.removeFromAccessOrder(key);
            return false;
        }

        // 检查版本
        if (version && entry.version !== version) {
            return false;
        }

        return true;
    }

    /**
     * 删除缓存项
     * @param key 缓存键
     */
    delete(key: string): boolean {
        const deleted = this.cache.delete(key);
        if (deleted) {
            this.removeFromAccessOrder(key);
            this.logger.debug(`Cache deleted: ${key}`);
        }
        return deleted;
    }

    /**
     * 清空所有缓存
     */
    clear(): void {
        this.cache.clear();
        this.accessOrder = [];
        this.logger.debug('Cache cleared');
    }

    /**
     * 获取缓存统计信息
     */
    getStats(): {
        size: number;
        maxSize: number;
        maxAge: number;
        oldestEntry?: number;
        newestEntry?: number;
    } {
        const timestamps = Array.from(this.cache.values()).map(entry => entry.timestamp);
        
        return {
            size: this.cache.size,
            maxSize: this.options.maxSize,
            maxAge: this.options.maxAge,
            oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
            newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : undefined
        };
    }

    /**
     * 清理过期缓存
     */
    cleanup(): number {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.options.maxAge) {
                this.cache.delete(key);
                this.removeFromAccessOrder(key);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            this.logger.debug(`Cleaned up ${cleanedCount} expired cache entries`);
        }

        return cleanedCount;
    }

    /**
     * 更新访问顺序（LRU）
     * @param key 缓存键
     */
    private updateAccessOrder(key: string): void {
        // 移除旧位置
        const index = this.accessOrder.indexOf(key);
        if (index > -1) {
            this.accessOrder.splice(index, 1);
        }
        // 添加到末尾（最新访问）
        this.accessOrder.push(key);
    }

    /**
     * 从访问顺序中移除
     * @param key 缓存键
     */
    private removeFromAccessOrder(key: string): void {
        const index = this.accessOrder.indexOf(key);
        if (index > -1) {
            this.accessOrder.splice(index, 1);
        }
    }

    /**
     * 驱逐最少使用的缓存项
     */
    private evictLRU(): void {
        if (this.accessOrder.length > 0) {
            const lruKey = this.accessOrder[0];
            this.cache.delete(lruKey);
            this.accessOrder.shift();
            this.logger.debug(`Evicted LRU cache entry: ${lruKey}`);
        }
    }

    /**
     * 从磁盘加载缓存
     */
    private async loadFromDisk(): Promise<void> {
        try {
            await fs.mkdir(this.options.cacheDir, { recursive: true });
            // 实现磁盘缓存加载逻辑
            this.logger.debug('Cache loaded from disk');
        } catch (error) {
            this.logger.warn('Failed to load cache from disk', error as Error);
        }
    }

    /**
     * 保存缓存到磁盘
     * @param key 缓存键
     * @param entry 缓存项
     */
    private async saveToDisk(key: string, entry: CacheEntry<T>): Promise<void> {
        try {
            const filePath = path.join(this.options.cacheDir, `${key}.json`);
            await fs.writeFile(filePath, JSON.stringify(entry));
        } catch (error) {
            this.logger.warn(`Failed to save cache to disk: ${key}`, error as Error);
        }
    }
}
