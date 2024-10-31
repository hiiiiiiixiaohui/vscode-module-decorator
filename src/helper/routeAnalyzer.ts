import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

// 路由配置接口
interface RouteConfig {
    path?: string;
    name?: string;
    component?: string;
    access?: string;
    title?: string;
    icon?: string;
    hideInMenu?: boolean;
    routes?: RouteConfig[];
}

// 模块映射接口
interface ModuleMapping {
    moduleName: string;
    routePath: string;
    filePath: string;
}

export class RouteAnalyzer {
    private workspaceRoot: string;
    private targetModulePath: string;
    private routeFilePath: string;
    private moduleMappings: Map<string, ModuleMapping>;
    private beenMappedFiles: Map<string, boolean>;

    constructor(context: vscode.ExtensionContext) {
        this.moduleMappings = new Map();
        this.beenMappedFiles = new Map();

        // 获取工作区根目录
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
            throw new Error('No workspace folder found');
        }
        this.workspaceRoot = workspaceFolders[0].uri.fsPath;
        this.targetModulePath = path.join(this.workspaceRoot, vscode.workspace.getConfiguration().get('extensionmodulemap.moduleSourceMapPath') || './src/pages');
        this.routeFilePath = path.join(this.workspaceRoot, vscode.workspace.getConfiguration().get('extensionmodulemap.routeConfigPath') || './config/routes.ts'); // 默认路由文件路径
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
            // 解析路由配置，扁平化处理
            const routes = await this.deepParseRouteConfig(content);

            // 建立模块映射
            await this.buildModuleMappings(routes);
        } catch (error) {
            console.error('Failed to analyze routes:', error);
            throw error;
        }
    }

    // Function to parse a single route object
    private parseRouteObject(str: string): RouteConfig | null {
        const route: RouteConfig = {};

        // Extract path
        const pathMatch = str.match(/path:\s*['"]([^'"]+)['"]/);
        if (pathMatch) { route.path = pathMatch[1]; }

        // Extract name
        const nameMatch = str.match(/name:\s*['"]([^'"]+)['"]/);
        if (nameMatch) { route.name = nameMatch[1]; }

        // Extract component
        const componentMatch = str.match(/component:\s*['"]([^'"]+)['"]/);
        if (componentMatch) { route.component = componentMatch[1]; }

        // Extract access
        const accessMatch = str.match(/access:\s*['"]([^'"]+)['"]/);
        if (accessMatch) { route.access = accessMatch[1]; }

        // Extract title
        const titleMatch = str.match(/title:\s*['"]([^'"]+)['"]/);
        if (titleMatch) { route.title = titleMatch[1]; }

        // Extract icon
        const iconMatch = str.match(/icon:\s*['"]([^'"]+)['"]/);
        if (iconMatch) { route.icon = iconMatch[1]; }

        // Extract hideInMenu
        const hideInMenuMatch = str.match(/hideInMenu:\s*(true|false)/);
        if (hideInMenuMatch) { route.hideInMenu = hideInMenuMatch[1] === 'true'; }

        return Object.keys(route).length > 0 ? route : null;
    }


    // 解析嵌套路由的结构,保留方案
    private parseRouteStructure(input: string) {
        let stack = [];
        let result = '';
        let inBracket = false;
        let bracketCount = 0;

        // Find the starting position of routes array
        const routesStart = input.indexOf('routes:');
        if (routesStart === -1) { return null; }

        // Move to the first '[' after 'routes:'
        let pos = routesStart;
        while (pos < input.length && input[pos] !== '[') { pos++; }

        // Parse from the starting bracket
        for (let i = pos; i < input.length; i++) {
            const char = input[i];

            if (char === '[') {
                bracketCount++;
                inBracket = true;
            } else if (char === ']') {
                bracketCount--;
            }

            result += char;

            // If we've closed all brackets, we're done
            if (inBracket && bracketCount === 0) {
                break;
            }
        }

        return result;
    }

    // 解析嵌套路由的函数
    private parseAndFlattenRoutes(str: string): RouteConfig[] {
        const flatRoutes: RouteConfig[] = [];
        const routeObjects = this.extractRouteObjects(str);

        for (const routeStr of routeObjects) {
            // Check if the current route object has nested routes
            const nestedRoutesMatch = routeStr.match(/routes:\s*\[([^[\]]*(?:\[(?:[^[\]]*(?:\[[^[\]]*\][^[\]]*)*)\][^[\]]*)*)\]/);
            // const nestedRoutesStr = this.parseRouteStructure(routeStr);
            if (nestedRoutesMatch) {
                // Recursively parse nested routes
                const nestedRoutes = this.parseAndFlattenRoutes(nestedRoutesMatch[1]);
                flatRoutes.push(...nestedRoutes);
            } else {
                // Parse route if it doesn't have nested routes
                const route = this.parseRouteObject(routeStr);
                if (route && route.path && route.component) {
                    flatRoutes.push(route);
                }
            }
        }

        return flatRoutes;
    }

    // Remove all types of comments first
    private removeComments = (str: string): string => {
        return str
            // 移除多行注释
            .replace(/\/\*[\s\S]*?\*\//g, '')
            // 移除单行注释
            .replace(/\/\/.*/g, '')
            // 移除空行
            .replace(/^\s*[\r\n]/gm, '')
            // 移除多余的逗号
            .replace(/,(\s*[}\]])/g, '$1')
            // 标准化空格
            .replace(/\s+/g, ' ')
            .trim();
    };


    // 解析输出对象结构，例如：前置解析{，遇到闭合标签}，则将当前对象解析出来
    private extractRouteObjects(str: string): string[] {
        const routes: string[] = [];
        let depth = 0;
        let start = 0;
        let currentSearchIndex = 0;

        while (currentSearchIndex < str.length) {
            if (str[currentSearchIndex] === "{") {
                if (depth === 0) { start = currentSearchIndex; }
                depth++;
            } else if (str[currentSearchIndex] === "}") {
                depth--;
                if (depth === 0) {
                    routes.push(str.slice(start, currentSearchIndex + 1));
                }
            }
            currentSearchIndex++;
        }

        return routes;
    }


    private async deepParseRouteConfig(content: string): Promise<RouteConfig[]> {
        try {
            const cleanContent = this.removeComments(content);

            // Find and parse the main export array
            const exportMatch = cleanContent.match(/export\s+default\s*\[([\s\S]*)\]/);
            if (!exportMatch) { return []; }
            return await this.parseAndFlattenRoutes(exportMatch[1]);

        } catch (error) {
            console.error('Failed to parse route config:', error);
            return [];
        }
    }

    /**
     * 截取模块名
     */
    /**
     * 从组件路径中提取模块名
     * @param componentPath 组件路径,例如: './EnterpriseIncoming/detail'
     * @returns 模块名,例如: 'EnterpriseIncoming'
     */
    private extractModuleName(componentPath: string): string {
        // 按'/'分割路径
        const pathParts = componentPath.split('/');
        // 返回第一段作为模块名
        return `${pathParts[0]}/${pathParts[1]}`;
    }

    /**
     * 建立模块映射关系
     */
    private async buildModuleMappings(routes: RouteConfig[]) {
        for await (const route of routes) {
            if (route.component) {
                // const moduleDirName = this.extractModuleName(route.component);

                const componentPath = this.resolveComponentPath(route.component);

                // 获取模块目录下的所有相关文件
                const componentDir = path.dirname(`${componentPath}/*`);
                // 映射模块文件
                await this.mapModuleFiles(componentDir, route.name!, route.path!);
            }
        }
    }

    /**
     * 映射模块下的所有相关文件
     */
    private async mapModuleFiles(dir: string, moduleName: string, routePath: string) {
        try {
            const files = await fs.readdir(dir, { withFileTypes: true });

            // 检查目录名是否与模块名匹配
            for (const file of files) {
                const filePath = path.join(dir, file.name);
                if (file.isDirectory()) {
                    // 递归处理子目录,但保持原始moduleName不变
                    await this.mapModuleFiles(filePath, moduleName, routePath);
                } else if (this.isRelevantFile(file.name)) {
                    // 添加到映射,使用原始moduleName
                    const mapping: ModuleMapping = {
                        moduleName,
                        routePath,
                        filePath
                    };
                    if (!this.moduleMappings.has(filePath)) {
                        this.moduleMappings.set(filePath, mapping);
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to map files in directory ${dir}:`, error);
        }
    }
    /**
     * 解析组件完整路径
     */
    private resolveComponentPath(componentPath: string): string {
        if (componentPath.startsWith('@')) {
            // 处理别名路径
            return path.join(this.targetModulePath, componentPath.slice(2));
        }
        return path.join(this.targetModulePath, componentPath);
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
        const watcher2 = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, '**/src/pages/**/*')
        );

        watcher.onDidChange(() => this.analyzeRoutes());
        watcher.onDidCreate(() => this.analyzeRoutes());
        watcher.onDidDelete(() => this.analyzeRoutes());

        watcher2.onDidChange(() => this.analyzeRoutes());
        watcher2.onDidCreate(() => this.analyzeRoutes());
        watcher2.onDidDelete(() => this.analyzeRoutes());
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