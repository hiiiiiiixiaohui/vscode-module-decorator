import * as fs from 'fs/promises';
import * as path from 'path';
import * as parser from '@babel/parser';
import traverse from "@babel/traverse";
import * as vscode from 'vscode';


export class Parser {
    private workspaceRoot: string;
    private targetModulePath: string;
    private routeFilePath: string;
    private importMap: Map<string, string[]>;
    private aliasConfigs: [string, string][];
    private allowedExtensions: string[];


    constructor(context: vscode.ExtensionContext) {
        this.importMap = new Map();
        this.aliasConfigs = [];
        this.allowedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue'];

        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
            throw new Error('No workspace folder found');
        }

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
        const config = await fs.readFile(configPath, 'utf-8');
        try {
            const configObj = JSON.parse(config);
            const paths = configObj?.compilerOptions?.paths;
            if (!paths) {
                vscode.window.showErrorMessage('No paths found in config file!');
            } else {
                // 将paths对象转换为二维数组
                this.aliasConfigs = Object.entries(paths).map(([key, value]) => {
                    if (!Array.isArray(value) || !value.length) {
                        throw new Error(`Invalid path value for key: ${key}`);
                    }
                    return [key, value[0]];
                }) as [string, string][];
            }
        } catch (e) {
            vscode.window.showErrorMessage('Invalid config(jsconfig.json|tsconfig.json) file!');
        }
    }


    // 执行该方法前必须先解析完模块存在的paths别名
    private async parse(filePath: string) {
        // const dirPath = path.resolve(this.targetModulePath, `${filePath}`);
        try {
            if (!this.allowedExtensions.includes(path.extname(filePath)) || filePath.includes('.d.ts')) {
                return [];
            }


            console.log('filePath', filePath);

            const code = await fs.readFile(filePath, 'utf-8');
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });

            // 缓存this
            const _this = this;
            // @ts-ignore
            traverse(ast, {
                ImportDeclaration(importPath: { node: { source: { value: string; }; }; }) {
                    console.log('importPath', importPath);
                    const importValue = importPath.node.source.value;


                    if (importValue.startsWith('@/')) {
                        // 替换别名
                    }

                    if (importValue.startsWith('@@/')) {
                        // 替换别名
                    }

                    if (importValue.startsWith('.')) {
                        // 替换相对路径
                    }

                    // if (
                    //     importValue.startsWith('@/') ||
                    //     importValue.startsWith('@@/') ||
                    //     importValue.startsWith('.')
                    // ) {
                    //     _this.importMap.set(filePath, [
                    //         ...(_this.importMap.get(filePath) || []),
                    //         path.join(path.dirname(filePath), importPath.node.source.value),
                    //     ]);
                    // }
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