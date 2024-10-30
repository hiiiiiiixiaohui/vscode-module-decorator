import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

// 路由配置接口
interface RouteConfig {
    path: string;
    name?: string;
    component?: string;
    children?: RouteConfig[];
    moduleName?: string;
}

// 模块映射接口
interface ModuleMapping {
    moduleName: string;
    routePath: string;
    filePath: string;
}

export class RouteAnalyzer {
    private workspaceRoot: string;
    private routeFilePath: string;
    private moduleMappings: Map<string, ModuleMapping>;

    constructor(context: vscode.ExtensionContext) {
        this.moduleMappings = new Map();

        // 获取工作区根目录
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
            throw new Error('No workspace folder found');
        }
        this.workspaceRoot = workspaceFolders[0].uri.fsPath;
        this.routeFilePath = path.join(this.workspaceRoot, './config/routes.ts'); // 默认路由文件路径
    }

    /**
     * 初始化路由分析器
     */
    public async initialize(): Promise<void> {
        try {
            await this.analyzeRoutes();
            // 注册文件监听
            this.watchRouteChanges();
        } catch (error) {
            console.error('Failed to initialize route analyzer:', error);
            throw error;
        }
    }

    /**
     * 分析路由文件并建立映射
     */
    private async analyzeRoutes(): Promise<void> {
        try {
            // 读取路由文件
            const content = await fs.readFile(this.routeFilePath, 'utf-8');
            // 解析路由配置
            const routes = this.parseRouteConfig(content);

            console.log('routes', routes);

            // 建立模块映射
            await this.buildModuleMappings(routes);
        } catch (error) {
            console.error('Failed to analyze routes:', error);
            throw error;
        }
    }

    /**
     * 解析路由配置文件内容
     */
    private parseRouteConfig(content: string): RouteConfig[] {
        try {
            // 使用正则表达式提取路由信息
            // const routeRegex = /{\s*path:\s*['"]([^'"]+)['"],\s*name:\s*['"]([^'"]+)['"],\s*component:\s*(?:async\s*\(\)\s*=>\s*)?(?:import\(['"]([^'"]+)['"]\)|['"]([^'"]+)['"])/g;
            const routeRegex = /{\s*path:\s*['"]([^'"]+)['"],\s*name:\s*['"]([^'"]+)['"],\s*component:\s*['"]([^'"]+)['"]/g;
            const routes: RouteConfig[] = [];

            let match;
            while ((match = routeRegex.exec(content)) !== null) {
                const [, path, name, asyncComponent, directComponent] = match;
                routes.push({
                    path,
                    name,
                    component: asyncComponent || directComponent
                });
            }

            return routes;
        } catch (error) {
            console.error('Failed to parse route config:', error);
            return [];
        }
    }

    /**
     * 建立模块映射关系
     */
    private async buildModuleMappings(routes: RouteConfig[]): Promise<void> {
        for (const route of routes) {
            if (route.component) {
                // const moduleName = this.extractModuleName(route.path);
                const componentPath = this.resolveComponentPath(route.component);

                // 获取组件目录下的所有相关文件
                const componentDir = path.dirname(componentPath);
                await this.mapModuleFiles(componentDir, route.name!, route.path);
            }

            if (route.children) {
                await this.buildModuleMappings(route.children);
            }
        }
    }

    /**
     * 映射模块下的所有相关文件
     */
    private async mapModuleFiles(dir: string, moduleName: string, routePath: string): Promise<void> {
        try {
            const files = await fs.readdir(dir, { withFileTypes: true });

            for (const file of files) {
                const filePath = path.join(dir, file.name);

                if (file.isDirectory()) {
                    // 递归处理子目录
                    await this.mapModuleFiles(filePath, moduleName, routePath);
                } else if (this.isRelevantFile(file.name)) {
                    // 添加到映射
                    const mapping: ModuleMapping = {
                        moduleName,
                        routePath,
                        filePath
                    };
                    this.moduleMappings.set(filePath, mapping);
                }
            }
        } catch (error) {
            console.error(`Failed to map files in directory ${dir}:`, error);
        }
    }

    /**
     * 从路径提取模块名称
     */
    private extractModuleName(routePath: string): string {
        // 移除开头的斜杠并获取第一段路径作为模块名
        return routePath.replace(/^\//, '').split('/')[0];
    }

    /**
     * 解析组件完整路径
     */
    private resolveComponentPath(componentPath: string): string {
        if (componentPath.startsWith('@')) {
            // 处理别名路径
            return path.join(this.workspaceRoot, 'src', componentPath.slice(2));
        }
        return path.join(this.workspaceRoot, componentPath);
    }

    /**
     * 判断是否为相关文件
     */
    private isRelevantFile(fileName: string): boolean {
        const relevantExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue'];
        return relevantExtensions.some(ext => fileName.endsWith(ext));
    }

    /**
     * 监听路由文件变化
     */
    private watchRouteChanges(): void {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, '**/routes/**/*')
        );

        watcher.onDidChange(() => this.analyzeRoutes());
        watcher.onDidCreate(() => this.analyzeRoutes());
        watcher.onDidDelete(() => this.analyzeRoutes());
    }

    /**
     * 获取文件对应的模块信息
     */
    public getModuleForFile(filePath: string): ModuleMapping | undefined {
        return this.moduleMappings.get(filePath);
    }

    /**
     * 更新路由文件路径
     */
    public async updateRoutePath(newPath: string): Promise<void> {
        this.routeFilePath = path.join(this.workspaceRoot, newPath);
        await this.analyzeRoutes();
    }
}