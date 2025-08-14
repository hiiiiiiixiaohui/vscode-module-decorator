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

    constructor(_context: vscode.ExtensionContext) {
        this.dependencyCache = new Map();
        this.aliasConfigs = {};
        this.allowedExtensions = [...DEFAULT_EXTENSIONS, '.ts', '.tsx', '.js', '.jsx', '.vue'];
        this.logger = Logger.getInstance();

        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
            throw new Error('No workspace folder found');
        }

        this.workspaceRoot = workspaceFolders[0].uri.fsPath;
    }

    /**
     * 获取js|tsconfig.json文件内容
     */
    public async initBeforeParseConfig(): Promise<void> {
        try {
            this.logger.debug('Initializing parser configuration...');

            const jsConfigPath = path.join(this.workspaceRoot, 'jsconfig.json');
            const tsConfigPath = path.join(this.workspaceRoot, 'tsconfig.json');

            // 优先使用tsconfig.json
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

            const config = await fs.readFile(configPath, 'utf-8');
            const configObj = JSON.parse(config);
            const paths = configObj?.compilerOptions?.paths;

            if (paths) {
                this.parseAlias(paths);
                this.logger.debug('Alias configuration loaded', { aliasCount: Object.keys(this.aliasConfigs).length });
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
            // 判断paths内的value是否包含pages目录
            const hasPages = value.some(p_str => {
                // 匹配src开头的路径
                const srcPath = new RegExp(/^\.\/src\/\*$/).test(p_str);
                // 匹配src/pages目录
                const pagesPath = new RegExp(/^\.\/src\/pages\/\*$/).test(p_str);
                // 直接判断是否包含标准化后的目标路径
                return srcPath || pagesPath;
            });
            if (hasPages) {
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
                ImportDeclaration: (path: any) => {
                    const importInfo = this.extractImportInfo(path.node);
                    if (importInfo) {
                        imports.push(importInfo);
                        dependencies.push(importInfo.source);
                    }
                },
                ExportNamedDeclaration: (path: any) => {
                    if (path.node.declaration) {
                        const exportNames = this.extractExportNames(path.node.declaration);
                        exports.push(...exportNames);
                    }
                },
                ExportDefaultDeclaration: (_path: any) => {
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
     * @param importPath 导入路径
     * @param fromFile 导入文件的路径
     * @returns 解析后的绝对路径
     */
    private async resolveImportPath(importPath: string, fromFile: string): Promise<string> {
        // 处理别名路径
        const aliasKeys = Object.keys(this.aliasConfigs);
        for (const alias of aliasKeys) {
            if (importPath.startsWith(alias)) {
                const aliasRules = this.aliasConfigs[alias];
                for (const rule of aliasRules) {
                    const resolvedPath = path.join(
                        this.workspaceRoot,
                        importPath.replace(alias, rule.replace('*', ''))
                    );

                    // 尝试找到实际文件
                    const actualPath = await this.findActualFile(resolvedPath);
                    if (actualPath) {
                        return actualPath;
                    }
                }
            }
        }

        // 处理相对路径
        if (importPath.startsWith('.')) {
            const resolvedPath = path.resolve(path.dirname(fromFile), importPath);
            const actualPath = await this.findActualFile(resolvedPath);
            if (actualPath) {
                return actualPath;
            }
        }

        // 处理node_modules或其他绝对路径
        return importPath;
    }

    /**
     * 查找实际文件路径（处理扩展名和index文件）
     * @param basePath 基础路径
     * @returns 实际文件路径
     */
    private async findActualFile(basePath: string): Promise<string | null> {
        // 如果已经有扩展名，直接检查
        if (path.extname(basePath)) {
            try {
                await fs.access(basePath);
                return basePath;
            } catch {
                return null;
            }
        }

        // 尝试添加扩展名
        for (const ext of this.allowedExtensions) {
            const filePath = basePath + ext;
            try {
                await fs.access(filePath);
                return filePath;
            } catch {
                // 继续尝试下一个扩展名
            }
        }

        // 尝试index文件
        for (const ext of this.allowedExtensions) {
            const indexPath = path.join(basePath, `index${ext}`);
            try {
                await fs.access(indexPath);
                return indexPath;
            } catch {
                // 继续尝试下一个扩展名
            }
        }

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
     * 获取文件的所有依赖文件路径
     * @param filePath 文件路径
     * @returns 依赖文件路径数组
     */
    public async getDependencies(filePath: string): Promise<string[]> {
        const dependencyInfo = await this.analyze(filePath);
        if (!dependencyInfo) {
            return [];
        }

        const dependencies: string[] = [];
        for (const importInfo of dependencyInfo.imports) {
            if (importInfo.resolvedPath && importInfo.resolvedPath.startsWith(this.workspaceRoot)) {
                dependencies.push(importInfo.resolvedPath);
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