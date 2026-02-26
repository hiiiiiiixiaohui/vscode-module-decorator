import * as fs from 'fs/promises';
import * as path from 'path';
import * as parser from '@babel/parser';
// @ts-ignore
import { DEFAULT_EXTENSIONS } from '@babel/core';
import traverse from "@babel/traverse";
import * as vscode from 'vscode';

import { Logger } from '../utils/logger';

// 导入信息接口
interface ImportInfo {
    source: string;
    specifiers: string[];
    importType: 'default' | 'named' | 'namespace' | 'side-effect';
    resolvedPath?: string;
}

// 文件依赖信息接口
interface FileDependencyInfo {
    filePath: string;
    imports: ImportInfo[];
    exports: string[];
    dependencies: string[];
}


export class Parser {
    private workspaceRoot: string;
    private dependencyCache: Map<string, FileDependencyInfo>;
    private aliasConfigs: Record<string, string[]>;
    private allowedExtensions: string[];
    private logger: Logger;
    // tsconfig baseUrl 解析后的绝对路径，用于正确计算 paths 规则的目标目录
    private baseDir: string;

    constructor(_context: vscode.ExtensionContext, workspaceRoot: string) {
        this.dependencyCache = new Map();
        this.aliasConfigs = {};
        this.allowedExtensions = [...DEFAULT_EXTENSIONS, '.ts', '.tsx', '.js', '.jsx', '.vue'];
        this.logger = Logger.getInstance();
        this.workspaceRoot = workspaceRoot;
        this.baseDir = workspaceRoot;
    }

    /**
     * 剥除 JSONC（JSON with Comments）格式中的注释和尾随逗号。
     * tsconfig.json / jsconfig.json 均为 JSONC 格式，允许 // 行注释、
     * /* 块注释 * / 以及对象/数组末尾的尾随逗号，但标准 JSON.parse 不支持这些，
     * 必须预处理后再解析，否则任何含注释的配置文件都会导致解析静默失败。
     */
    private stripJsonComments(str: string): string {
        // 去除块注释（/* ... */）
        let result = str.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
        // 去除行注释（// ...），保留换行符以维持行号
        result = result.replace(/\/\/[^\n\r]*/g, '');
        // 去除尾随逗号（JSON 不允许，但 JSONC 允许）
        result = result.replace(/,(\s*[}\]])/g, '$1');
        return result;
    }

    /**
     * 读取 tsconfig.json / jsconfig.json，提取路径别名（paths）和 baseUrl
     */
    public async initBeforeParseConfig(): Promise<void> {
        try {
            this.logger.debug('Initializing parser configuration...');

            const jsConfigPath = path.join(this.workspaceRoot, 'jsconfig.json');
            const tsConfigPath = path.join(this.workspaceRoot, 'tsconfig.json');

            // 优先使用 tsconfig.json
            let configPath = '';
            try {
                await fs.access(tsConfigPath);
                configPath = tsConfigPath;
                this.logger.debug('Using tsconfig.json');
            } catch {
                try {
                    await fs.access(jsConfigPath);
                    configPath = jsConfigPath;
                    this.logger.debug('Using jsconfig.json');
                } catch {
                    this.logger.warn('No TypeScript/JavaScript config file found, using default settings');
                    return;
                }
            }

            const raw = await fs.readFile(configPath, 'utf-8');
            // tsconfig 是 JSONC 格式（支持注释和尾随逗号），JSON.parse 无法直接解析，需先剥除
            const configObj = JSON.parse(this.stripJsonComments(raw));
            const compilerOptions = configObj?.compilerOptions ?? {};

            // 读取 baseUrl：TypeScript 规定 paths 中的相对路径均相对于 baseUrl 解析，
            // 而非相对于 workspaceRoot。若不读取 baseUrl，别名路径会算错目录。
            const baseUrlRaw: string | undefined = compilerOptions.baseUrl;
            const configDir = path.dirname(configPath);
            this.baseDir = baseUrlRaw
                ? path.resolve(configDir, baseUrlRaw)
                : configDir;

            const paths = compilerOptions.paths;
            if (paths) {
                this.parseAlias(paths);
                this.logger.debug('Alias configuration loaded', {
                    aliasCount: Object.keys(this.aliasConfigs).length,
                    baseDir: this.baseDir,
                });
            } else {
                this.logger.debug('No path aliases found in config file');
            }

        } catch (error) {
            this.logger.error('Failed to initialize parser configuration', error as Error);
            // 不抛出错误，使用默认配置继续运行
        }
    }


    private parseAlias(paths: Record<string, string[]>) {
        Object.entries(paths).forEach(([key, value]) => {
            // 注册所有指向本地文件系统路径的别名：
            //   - 相对路径（./ 或 ../ 开头）→ 明确的本地路径
            //   - 裸路径（如 src/*，不以 / 或 @ 开头，不含 node_modules）→ 也视为本地路径
            // 不限制必须指向 src/pages，让下游的 workspaceRoot 过滤和 allFilesSet 过滤来控制范围
            const hasLocalPath = value.some(p => {
                if (p.startsWith('./') || p.startsWith('../')) { return true; }
                if (p.startsWith('/') || p.startsWith('@')) { return false; }
                return !p.includes('node_modules');
            });
            if (hasLocalPath) {
                this.aliasConfigs[key.replace('*', '')] = value;
            }
        });
    }




    /**
     * 解析文件的依赖关系
     * @param filePath 文件路径
     * @returns 文件依赖信息
     */
    private async parse(filePath: string): Promise<FileDependencyInfo | null> {
        try {
            // 检查缓存
            if (this.dependencyCache.has(filePath)) {
                return this.dependencyCache.get(filePath)!;
            }

            if (!this.allowedExtensions.includes(path.extname(filePath)) || filePath.includes('.d.ts')) {
                return null;
            }

            const code = await fs.readFile(filePath, 'utf-8');
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript', 'decorators-legacy'],
                allowImportExportEverywhere: true,
            });

            const imports: ImportInfo[] = [];
            const exports: string[] = [];
            const dependencies: string[] = [];

            // @ts-ignore
            traverse(ast, {
                ImportDeclaration: (nodePath: any) => {
                    const importInfo = this.extractImportInfo(nodePath.node);
                    if (importInfo) {
                        imports.push(importInfo);
                        dependencies.push(importInfo.source);
                    }
                },
                // export { X } from '@/...' 或 export type { X } from '@/...'
                // 这类重导出语句既是导出也是依赖来源，必须纳入依赖追踪，
                // 否则 barrel 文件（index.ts 统一 re-export）会使 BFS 在此断链。
                ExportNamedDeclaration: (nodePath: any) => {
                    if (nodePath.node.source) {
                        const importInfo = this.extractImportInfo(nodePath.node);
                        if (importInfo) {
                            imports.push(importInfo);
                            dependencies.push(importInfo.source);
                        }
                    }
                    if (nodePath.node.declaration) {
                        const exportNames = this.extractExportNames(nodePath.node.declaration);
                        exports.push(...exportNames);
                    }
                },
                // export * from '@/...' 或 export * as ns from '@/...'
                ExportAllDeclaration: (nodePath: any) => {
                    if (nodePath.node.source?.value) {
                        imports.push({
                            source: nodePath.node.source.value,
                            specifiers: ['*'],
                            importType: 'namespace',
                        });
                        dependencies.push(nodePath.node.source.value);
                    }
                },
                ExportDefaultDeclaration: (_nodePath: any) => {
                    exports.push('default');
                }
            });

            // 解析导入路径
            for (const importInfo of imports) {
                try {
                    importInfo.resolvedPath = await this.resolveImportPath(importInfo.source, filePath);
                } catch (error) {
                    console.warn(`Failed to resolve import path: ${importInfo.source}`, error);
                }
            }

            const dependencyInfo: FileDependencyInfo = {
                filePath,
                imports,
                exports,
                dependencies
            };

            // 缓存结果
            this.dependencyCache.set(filePath, dependencyInfo);
            return dependencyInfo;

        } catch (error) {
            console.error(`Failed to parse file ${filePath}:`, error);
            return null;
        }
    }

    /**
     * 提取导入信息
     * @param node AST导入声明节点
     * @returns 导入信息
     */
    private extractImportInfo(node: any): ImportInfo | null {
        if (!node.source || !node.source.value) {
            return null;
        }

        const source = node.source.value;
        const specifiers: string[] = [];
        let importType: ImportInfo['importType'] = 'side-effect';

        if (node.specifiers && node.specifiers.length > 0) {
            for (const spec of node.specifiers) {
                if (spec.type === 'ImportDefaultSpecifier') {
                    specifiers.push('default');
                    importType = 'default';
                } else if (spec.type === 'ImportNamespaceSpecifier') {
                    specifiers.push('*');
                    importType = 'namespace';
                } else if (spec.type === 'ImportSpecifier') {
                    specifiers.push(spec.imported.name);
                    importType = 'named';
                }
            }
        }

        return {
            source,
            specifiers,
            importType
        };
    }

    /**
     * 提取导出名称
     * @param declaration AST导出声明节点
     * @returns 导出名称数组
     */
    private extractExportNames(declaration: any): string[] {
        const names: string[] = [];

        if (declaration.type === 'VariableDeclaration') {
            for (const declarator of declaration.declarations) {
                if (declarator.id.type === 'Identifier') {
                    names.push(declarator.id.name);
                }
            }
        } else if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
            if (declaration.id && declaration.id.name) {
                names.push(declaration.id.name);
            }
        }

        return names;
    }

    /**
     * 解析导入路径为绝对路径
     * @param importPath 导入路径（import 语句中的原始字符串）
     * @param fromFile   包含该 import 的文件绝对路径
     * @returns 项目内文件返回其绝对路径；node_modules / 无法解析的路径返回原始字符串
     */
    private async resolveImportPath(importPath: string, fromFile: string): Promise<string> {
        // 处理 tsconfig/jsconfig 中配置的别名路径
        // 按别名长度从长到短排序，避免较短的别名（如 @/）误匹配属于更长别名（如 @@/）的导入
        const aliasKeys = Object.keys(this.aliasConfigs).sort((a, b) => b.length - a.length);
        for (const alias of aliasKeys) {
            if (!importPath.startsWith(alias)) { continue; }

            const suffix = importPath.slice(alias.length); // 去掉别名前缀后的剩余路径
            for (const rule of this.aliasConfigs[alias]) {
                // TypeScript 规定：paths 中的规则路径相对于 baseUrl 解析，不是相对于 workspaceRoot。
                // 例如 baseUrl="." paths={"@/*":["./src/*"]} 与
                //      baseUrl="./src" paths={"@/*":["./*"]} 最终应解析到相同的目录。
                const ruleBase = rule.replace('*', '');
                const targetBase = path.resolve(this.baseDir, ruleBase);
                const resolvedPath = path.join(targetBase, suffix);
                const actualPath = await this.findActualFile(resolvedPath);
                if (actualPath) {
                    return actualPath;
                }
            }
        }

        // 处理相对路径（. 或 .. 开头）
        if (importPath.startsWith('.')) {
            const resolvedPath = path.resolve(path.dirname(fromFile), importPath);
            const actualPath = await this.findActualFile(resolvedPath);
            if (actualPath) {
                return actualPath;
            }
        }

        // @/ 兜底解析：
        // 很多项目（Umi、CRA 等）通过 webpack/Vite/框架内置机制将 @/ 映射到 src/，
        // 而不在 tsconfig paths 里声明。上方别名循环未命中时，自动尝试 workspaceRoot/src/ 作为回退。
        if (importPath.startsWith('@/')) {
            const srcPath = path.join(this.workspaceRoot, 'src', importPath.slice(2));
            const actualPath = await this.findActualFile(srcPath);
            if (actualPath) {
                return actualPath;
            }
        }

        // node_modules 或其他无法解析的裸模块名，原样返回（由调用方的 workspaceRoot 过滤掉）
        return importPath;
    }

    /**
     * 查找实际文件路径（处理扩展名、.d.ts 声明文件和 index 文件）
     *
     * 扩展名优先级：先尝试可执行源文件（.ts/.tsx/.js/.jsx 等），再尝试 .d.ts 类型声明文件。
     * 这样当 .ts 和 .d.ts 同名共存时，优先使用 .ts；
     * 当只有 .d.ts 时（如项目自定义类型声明），也能正确找到，
     * 使其出现在依赖图中，BFS 才能到达并分配正确的模块名。
     */
    private async findActualFile(basePath: string): Promise<string | null> {
        // 如果已经有扩展名，直接检查（包括 .d.ts 路径）
        if (path.extname(basePath)) {
            try {
                await fs.access(basePath);
                return basePath;
            } catch {
                return null;
            }
        }

        // 优先尝试可执行源文件扩展名
        for (const ext of this.allowedExtensions) {
            const filePath = basePath + ext;
            try {
                await fs.access(filePath);
                return filePath;
            } catch {
                // 继续尝试下一个扩展名
            }
        }

        // 再尝试 .d.ts 类型声明文件（排在源文件之后，确保源文件优先）
        const dtsPath = basePath + '.d.ts';
        try {
            await fs.access(dtsPath);
            return dtsPath;
        } catch { /* 继续 */ }

        // 尝试 index 源文件
        for (const ext of this.allowedExtensions) {
            const indexPath = path.join(basePath, `index${ext}`);
            try {
                await fs.access(indexPath);
                return indexPath;
            } catch {
                // 继续尝试下一个扩展名
            }
        }

        // 尝试 index.d.ts
        const indexDtsPath = path.join(basePath, 'index.d.ts');
        try {
            await fs.access(indexDtsPath);
            return indexDtsPath;
        } catch { /* 继续 */ }

        return null;
    }

    /**
     * 分析文件依赖关系
     * @param filePath 文件路径
     * @returns 文件依赖信息
     */
    public async analyze(filePath: string): Promise<FileDependencyInfo | null> {
        return await this.parse(filePath);
    }

    /**
     * 获取文件的所有项目内依赖文件路径
     * 判断标准：已解析为绝对路径、位于 workspaceRoot 下、且不在 node_modules 中。
     * 未能解析的裸模块名（如 'react'、'lodash'）或别名解析失败的路径会被自动过滤掉。
     */
    public async getDependencies(filePath: string): Promise<string[]> {
        const dependencyInfo = await this.analyze(filePath);
        if (!dependencyInfo) {
            return [];
        }

        const nodeModulesSep = `${path.sep}node_modules${path.sep}`;
        const dependencies: string[] = [];
        for (const importInfo of dependencyInfo.imports) {
            const resolved = importInfo.resolvedPath;
            // 只统计项目源文件：必须是绝对路径、在工作区内、且不属于 node_modules
            if (resolved &&
                resolved.startsWith(this.workspaceRoot) &&
                !resolved.includes(nodeModulesSep)) {
                dependencies.push(resolved);
            }
        }

        return dependencies;
    }

    /**
     * 清除缓存
     */
    public clearCache(): void {
        this.dependencyCache.clear();
    }

}