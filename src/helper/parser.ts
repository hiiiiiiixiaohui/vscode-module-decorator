import * as fs from 'fs/promises';
import * as path from 'path';
import * as parser from '@babel/parser';
// @ts-ignore
import { DEFAULT_EXTENSIONS } from '@babel/core';
import traverse from "@babel/traverse";
import * as vscode from 'vscode';
import type { Dirent } from 'fs';


export class Parser {
    private workspaceRoot: string;
    private targetModulePath: string;
    private routeFilePath: string;
    private importMap: Map<string, string[]>;
    private aliasConfigs: Record<string, string[]>;
    private allowedExtensions: string[];
    private pagesRegx: RegExp;
    private dotsRegx: RegExp;


    constructor(context: vscode.ExtensionContext) {
        this.importMap = new Map();
        this.aliasConfigs = {};
        this.allowedExtensions = [...DEFAULT_EXTENSIONS, '.ts', '.tsx', '.js', '.jsx', '.vue'];
        // hardcode get pages dir files
        this.pagesRegx = /^\@\/pages\/(.*)/g;
        // get relative path files
        this.dotsRegx = /^\.\.?\/(.*)/g;

        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
            throw new Error('No workspace folder found');
        }
        // common path
        this.workspaceRoot = workspaceFolders[0].uri.fsPath;
        this.targetModulePath = path.join(this.workspaceRoot, vscode.workspace.getConfiguration().get('extensionmodulemap.moduleSourceMapPath') || `.${path.sep}src${path.sep}pages`);
        this.routeFilePath = path.join(this.workspaceRoot, vscode.workspace.getConfiguration().get('extensionmodulemap.routeConfigPath') || `.${path.sep}config${path.sep}routes.ts`);

    }

    /**
     * 获取js|tsconfig.json文件内容
     */
    public async initBeforeParseConfig(): Promise<void> {
        const jsConfigPath = path.join(this.workspaceRoot, 'jsconfig.json');
        const tsConfigPath = path.join(this.workspaceRoot, 'tsconfig.json');
        const configPath = await fs.access(tsConfigPath).then(() => tsConfigPath).catch(() => jsConfigPath).catch(() => '');
        if (!configPath) {
            vscode.window.showErrorMessage('No config(jsconfig.json|tsconfig.json) file found!');
        }
        try {
            const config = await fs.readFile(configPath, 'utf-8');
            const configObj = JSON.parse(config);
            const paths = configObj?.compilerOptions?.paths;
            if (!paths) {
                vscode.window.showErrorMessage('No paths found in config file!');
            } else {
                this.parseAlias(paths);
            }

        } catch (e) {
            vscode.window.showErrorMessage('Invalid config(jsconfig.json|tsconfig.json) file!');
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

    private async parseFullPath(dirPath: string, module: string) {
        const dirs = await fs.readdir(dirPath, { withFileTypes: true });
        for (const file of dirs) {
            if (!file.isDirectory()) {
                module = this.findFile(dirs, module);
            }
        }
        return module;
    }

    private findFile(files: Dirent[], findPath: string, isRoot?: boolean): string {
        let currentFilePath: string = '';

        let file = files.find((file) => {
            if (isRoot) {
                findPath = findPath + 'index'; // import xxx from '@/pages/module', default export module index.xxx file
                currentFilePath = path.join(findPath, file.name);
            }
            return currentFilePath.includes(findPath);
        });
        if (!file) {
            file = files.find((file) => {
                currentFilePath = path.join(path.dirname(findPath), file.name);
                return currentFilePath.includes(findPath);
            });
        }

        return path.join(file?.parentPath || path.dirname(findPath), file?.name!);
    }
    // 转换别名操作
    private async transformAliasToAbs(importModulePath: string, originFilePath: string, alias?: string): Promise<string> {
        let transformPath: string = '';
        if (alias) {
            const aliasRules = this.aliasConfigs[alias];
            // 别用forEach await
            for (const alasRule of aliasRules) {
                // @/pages/xxx
                // 完整别名的文件根路径 xxx/project/src/xxx
                const fullFilePath = path.join(this.workspaceRoot, importModulePath.replace(alias, alasRule.replace('*', '')));

                // 优先遍历识别当前url是否为目录(是则返回文件目录列表，否则报错通过catch查找上级目录)
                await fs.readdir(fullFilePath, { withFileTypes: true }).then((files) => {
                    transformPath = this.findFile(files, fullFilePath, true);
                    // 查找当前符合条件的文件路径
                }).catch(async () => {
                    const parentDir = path.dirname(fullFilePath);
                    const result = await this.parseFullPath(parentDir, fullFilePath);
                    transformPath = result;
                });

            }
        } else {
            const fileFulePath = path.join(path.dirname(originFilePath), importModulePath);
            transformPath = await this.parseFullPath(path.dirname(fileFulePath), fileFulePath);
        }
        return transformPath;
    }

    // 执行该方法前必须先解析完模块存在的paths别名
    private async parse(filePath: string) {
        // const dirPath = path.resolve(this.targetModulePath, `${filePath}`);
        try {
            if (!this.allowedExtensions.includes(path.extname(filePath)) || filePath.includes('.d.ts')) {
                return [];
            }

            const code = await fs.readFile(filePath, 'utf-8');
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });

            // save this
            const _this = this;
            const alias = Object.keys(this.aliasConfigs);

            // @ts-ignore
            traverse(ast, {
                ImportDeclaration(importPath: { node: { source: { value: string; }; }; }) {
                    const importModulePath = importPath.node.source.value;

                    // 存在别名则遍历
                    if (alias?.length) {
                        // 遍历alias
                        alias.forEach(async (key) => {
                            if (_this.pagesRegx.test(importModulePath)) {
                                const obsPath = await _this.transformAliasToAbs(importModulePath, filePath, key);
                                _this.importMap.set(filePath, [
                                    ...(_this.importMap.get(filePath) || []),
                                    obsPath,
                                ]);
                            }
                        });
                    }
                    if (_this.dotsRegx.test(importModulePath)) {
                        const timer = setTimeout(async () => {
                            const obsPath = await _this.transformAliasToAbs(importModulePath, filePath);
                            _this.importMap.set(filePath, [
                                ...(_this.importMap.get(filePath) || []),
                                obsPath,
                            ]);
                            clearTimeout(timer);
                        }, 10);
                    }
                },
            });

            return [..._this.importMap.entries()];
        } catch (e) {
            console.log(e);
            return [];
        }

    }

    public async analyze(filePath: string) {
        return await this.parse(filePath);
    }

}