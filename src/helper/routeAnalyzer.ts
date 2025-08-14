import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { Parser } from './parser';
import { Logger } from '../utils/logger';
import { CacheManager } from '../utils/cacheManager';

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
    moduleNames: string | string[];
    routePath: string;
    hideInMenu: boolean;
    filePath: string;
    title: string;
    access: string;
}

export class RouteAnalyzer {
    private workspaceRoot: string;
    private targetModulePath: string;
    private routeFilePath: string;
    private initStatus: boolean = false;
    private moduleMappings: Map<string, ModuleMapping>;
    private rootModuleFileTags: Map<string, string[]>;
    private iteratorDirArray: WeakMap<any, string[]>;
    private routes: RouteConfig[];
    private relevantExtensions: string[];
    private parser: Parser;
    private logger: Logger;
    private routeCache: CacheManager<RouteConfig[]>;
    private mappingCache: CacheManager<ModuleMapping>;
    private fileWatchers: vscode.FileSystemWatcher[] = [];
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.moduleMappings = new Map();
        this.rootModuleFileTags = new Map();
        this.iteratorDirArray = new WeakMap();
        this.routes = [];
        this.relevantExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.json', '.d.ts', '.less', '.scss', '.css'];
        this.logger = Logger.getInstance();
        this.parser = new Parser(context);

        // 初始化缓存管理器
        const config = vscode.workspace.getConfiguration('extensionmodulemap');
        const cacheMaxAge = config.get<number>('cacheMaxAge', 300000);
        const enableCache = config.get<boolean>('enableCache', true);

        this.routeCache = new CacheManager<RouteConfig[]>({
            maxAge: enableCache ? cacheMaxAge * 2 : 0, // 路由缓存时间更长
            maxSize: 100
        });
        this.mappingCache = new CacheManager<ModuleMapping>({
            maxAge: enableCache ? cacheMaxAge : 0,
            maxSize: 1000
        });

        // 获取工作区根目录
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
            throw new Error('No workspace folder found');
        }
        this.workspaceRoot = workspaceFolders[0].uri.fsPath;
        this.targetModulePath = path.join(this.workspaceRoot, vscode.workspace.getConfiguration().get('extensionmodulemap.moduleSourceMapPath') || `.${path.sep}src${path.sep}pages`);
        this.routeFilePath = path.join(this.workspaceRoot, vscode.workspace.getConfiguration().get('extensionmodulemap.routeConfigPath') || `.${path.sep}config${path.sep}routes.ts`); // 默认路由文件路径
    }

    public async checkRouteFileExists(): Promise<boolean> {
        const routeExists = await fs.access(this.routeFilePath).then(() => true).catch(() => false);
        const targetModuleExists = await fs.access(this.targetModulePath).then(() => true).catch(() => false);
        return routeExists && targetModuleExists;
    }
    /**
     * 初始化路由分析器
     */

    public getInitStatus(): boolean {
        return this.initStatus;
    }

    public async initialize(): Promise<void> {
        try {
            this.logger.info('Initializing route analyzer...');

            // 检查路由文件是否存在
            if (!await this.checkRouteFileExists()) {
                this.logger.warn('Route file or target module path does not exist', {
                    routeFilePath: this.routeFilePath,
                    targetModulePath: this.targetModulePath
                });
                this.initStatus = false;
                return;
            }

            this.moduleMappings.clear();
            this.routes = [];

            // 分析路由文件
            await this.analyzeRoutes();

            this.logger.info('Route analyzer initialized successfully', {
                routesCount: this.routes.length,
                mappingsCount: this.moduleMappings.size
            });

            this.initStatus = true;
            // 注册文件监听
            this.watchFileChanges();
        } catch (error) {
            this.logger.error('Failed to initialize route analyzer', error as Error);
            this.initStatus = false;
            throw error;
        }
    }


    /**
     * 分析路由文件并建立映射
     */
    private async analyzeRoutes(): Promise<void> {
        try {
            this.logger.debug('Starting route analysis...');

            // 初始化json配置文件
            await this.parser.initBeforeParseConfig();

            // 读取路由文件
            const content = await fs.readFile(this.routeFilePath, 'utf-8');
            const checksum = this.calculateChecksum(content);
            this.logger.debug('Route file loaded', { size: content.length, checksum });

            // 检查缓存
            const cacheKey = `routes_${this.routeFilePath}`;
            const cachedRoutes = await this.routeCache.get(cacheKey);

            if (cachedRoutes) {
                this.routes = cachedRoutes;
                this.logger.debug('Routes loaded from cache', { routesCount: this.routes.length });
            } else {
                // 使用AST解析路由配置
                await this.parseRoutesWithAST(content);
                this.logger.debug('Routes parsed with AST', { routesCount: this.routes.length });

                // 缓存解析结果
                await this.routeCache.set(cacheKey, this.routes, '1.0.0', checksum);
            }

            // 建立模块映射
            await this.buildModuleMappings();
            this.logger.debug('Module mappings built', { mappingsCount: this.moduleMappings.size });

        } catch (error) {
            this.logger.error('Failed to analyze routes', error as Error);
            throw error;
        }
    }

    /**
     * 计算文件内容的校验和
     * @param content 文件内容
     * @returns MD5校验和
     */
    private calculateChecksum(content: string): string {
        return crypto.createHash('md5').update(content).digest('hex');
    }

    /**
     * 使用AST解析路由配置文件
     * @param content 路由文件内容
     */
    private async parseRoutesWithAST(content: string): Promise<void> {
        try {
            this.logger.debug('Parsing routes with AST...');

            // 解析TypeScript/JavaScript代码为AST
            const ast = parser.parse(content, {
                sourceType: 'module',
                plugins: ['typescript', 'jsx'],
                allowImportExportEverywhere: true,
                allowReturnOutsideFunction: true,
            });

            let routesFound = false;

            // 遍历AST查找export default
            // @ts-ignore
            traverse(ast, {
                ExportDefaultDeclaration: (path: any) => {
                    const declaration = path.node.declaration;
                    if (declaration.type === 'ArrayExpression') {
                        // 直接导出数组
                        this.routes = this.extractRoutesFromArray(declaration);
                        routesFound = true;
                        this.logger.debug('Found direct array export');
                    } else if (declaration.type === 'Identifier') {
                        // 导出变量，需要查找变量定义
                        const binding = path.scope.getBinding(declaration.name);
                        if (binding && binding.path.node.type === 'VariableDeclarator') {
                            const init = binding.path.node.init;
                            if (init && init.type === 'ArrayExpression') {
                                this.routes = this.extractRoutesFromArray(init);
                                routesFound = true;
                                this.logger.debug('Found variable array export');
                            }
                        }
                    }
                }
            });

            if (!routesFound) {
                this.logger.warn('No routes found in AST, falling back to regex parsing');
                await this.deepParseRouteConfig(content);
            }
        } catch (error) {
            this.logger.error('Failed to parse routes with AST, falling back to regex parsing', error as Error);
            // 回退到旧的解析方法
            await this.deepParseRouteConfig(content);
        }
    }

    /**
     * 从AST数组表达式中提取路由配置
     * @param arrayExpression AST数组表达式节点
     * @returns 扁平化的路由配置数组
     */
    private extractRoutesFromArray(arrayExpression: any): RouteConfig[] {
        const routes: RouteConfig[] = [];

        for (const element of arrayExpression.elements) {
            if (element && element.type === 'ObjectExpression') {
                const route = this.extractRouteFromObject(element);
                if (route) {
                    // 如果有嵌套路由，递归处理
                    if (route.routes && route.routes.length > 0) {
                        routes.push(...route.routes);
                    } else if (route.path && route.component) {
                        routes.push(route);
                    }
                }
            }
        }

        return routes;
    }

    /**
     * 从AST对象表达式中提取单个路由配置
     * @param objectExpression AST对象表达式节点
     * @returns 路由配置对象
     */
    private extractRouteFromObject(objectExpression: any): RouteConfig | null {
        const route: RouteConfig = {};

        for (const property of objectExpression.properties) {
            if (property.type === 'ObjectProperty' && property.key.type === 'Identifier') {
                const key = property.key.name;
                const value = property.value;

                switch (key) {
                    case 'path':
                        if (value.type === 'StringLiteral') {
                            route.path = value.value;
                        }
                        break;
                    case 'name':
                        if (value.type === 'StringLiteral') {
                            route.name = value.value;
                        }
                        break;
                    case 'component':
                        if (value.type === 'StringLiteral') {
                            route.component = value.value;
                        }
                        break;
                    case 'access':
                        if (value.type === 'StringLiteral') {
                            route.access = value.value;
                        }
                        break;
                    case 'title':
                        if (value.type === 'StringLiteral') {
                            route.title = value.value;
                        }
                        break;
                    case 'icon':
                        if (value.type === 'StringLiteral') {
                            route.icon = value.value;
                        }
                        break;
                    case 'hideInMenu':
                        if (value.type === 'BooleanLiteral') {
                            route.hideInMenu = value.value;
                        }
                        break;
                    case 'routes':
                        if (value.type === 'ArrayExpression') {
                            route.routes = this.extractRoutesFromArray(value);
                        }
                        break;
                }
            }
        }

        return Object.keys(route).length > 0 ? route : null;
    }

    /**
     *
     * @param str 单路由字符串，解析出 path、name、component、access、title、icon、hideInMenu
     * @returns RouteConfig
     */
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



    /**
     * @description 解析嵌套路由的函数
     * @param str 每个路由routes下的路由列表字符串，'[{},{},{}]'
     * @returns RouteConfig
     */
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


    /**
     * 
     * @param content routes.ts|.js 的路由内容，解析除export default 外的内容
     * @returns 
     */
    private async deepParseRouteConfig(content: string) {
        try {
            const cleanContent = this.removeComments(content);

            // Find and parse the main export array
            const exportMatch = cleanContent.match(/export\s+default\s*\[([\s\S]*)\]/);
            if (!exportMatch) { return []; }
            // 存储解析后的路由
            this.routes = this.parseAndFlattenRoutes(exportMatch[1]);
        } catch (error) {
            console.error('Failed to parse route config:', error);
            return error;
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
        const pathParts = componentPath.split(path.sep);
        // 返回第一段作为模块名
        return `${pathParts[0]}${path.sep}${pathParts[1]}`;
    }

    /**
     * @description 建立模块映射关系
     */
    private async buildModuleMappings(): Promise<void> {
        const startTime = Date.now();
        let processedCount = 0;
        let errorCount = 0;

        this.logger.debug('Building module mappings...', { routesCount: this.routes.length });

        // 使用并发处理，但限制并发数量以避免资源耗尽
        const concurrencyLimit = 5;
        const chunks = this.chunkArray(this.routes, concurrencyLimit);

        for (const chunk of chunks) {
            const promises = chunk.map(async (route) => {
                try {
                    if (route.component) {
                        const moduleDirName = this.extractModuleName(route.component);
                        const componentPath = this.resolveComponentPath(moduleDirName);

                        // 检查路径是否存在，避免无效的文件系统操作
                        const pathExists = await fs.access(componentPath).then(() => true).catch(() => false);
                        if (pathExists) {
                            await this.mapModuleFiles(
                                componentPath,
                                route.name || 'Unknown',
                                route.path || '',
                                route.component,
                                route.title || '',
                                route.access || '',
                                true
                            );
                        } else {
                            this.logger.warn('Component path does not exist', {
                                component: route.component,
                                path: componentPath
                            });
                        }
                    }
                    processedCount++;
                } catch (error) {
                    errorCount++;
                    this.logger.error('Failed to process route', error as Error, { route });
                }
            });

            await Promise.allSettled(promises);
        }

        const duration = Date.now() - startTime;
        this.logger.info('Module mappings built', {
            processedCount,
            errorCount,
            duration: `${duration}ms`,
            mappingsCount: this.moduleMappings.size
        });
    }

    /**
     * 将数组分块处理
     * @param array 要分块的数组
     * @param chunkSize 块大小
     * @returns 分块后的数组
     */
    private chunkArray<T>(array: T[], chunkSize: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    /**
     * @description 映射模块下的所有相关文件(递归)
     * @param dir 路由组件目录，例如 xxx/user, user是个目录
     * @param moduleName 当前路由模块名称，例如name: 登录
     * @param routePath 当前路由的页面路由路径
     * @param componentPath 当前路由组件路径
     * @param title  路由标题
     * @param access 路由权限
     * @param isRoot 是否为pages下的根文件
     */
    private async mapModuleFiles(dir: string, moduleName: string, routePath: string, componentPath: string, title: string, access: string, isRoot: boolean) {
        try {
            // 检查目录是否存在
            const dirExists = await fs.access(dir).then(() => true).catch(() => false);
            if (!dirExists) {
                return;
            }

            const files = await fs.readdir(dir, { withFileTypes: true });

            for (const file of files) {
                const filePath = path.join(dir, file.name);

                if (file.isDirectory()) {
                    // 递归处理子目录，避免重复处理
                    if (!this.iteratorDirArray.get(this)?.includes(filePath)) {
                        this.iteratorDirArray.set(this, [...this.iteratorDirArray.get(this) || [], filePath]);
                        await this.mapModuleFiles(filePath, moduleName, routePath, componentPath, title, access, false);
                    }
                } else if (this.isRelevantFile(file.name) && !this.moduleMappings.has(filePath)) {
                    // 处理文件映射
                    const mapping = await this.createFileMapping(filePath, moduleName, routePath, title, access, isRoot, dir);
                    if (mapping) {
                        this.moduleMappings.set(filePath, mapping);
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to map files in directory ${dir}:`, error);
        }
    }

    /**
     * 创建文件映射信息
     * @param filePath 文件路径
     * @param moduleName 模块名称
     * @param routePath 路由路径
     * @param title 标题
     * @param access 权限
     * @param isRoot 是否为根目录
     * @param dir 当前目录
     * @returns 模块映射信息
     */
    private async createFileMapping(
        filePath: string,
        moduleName: string,
        routePath: string,
        title: string,
        access: string,
        isRoot: boolean,
        dir: string
    ): Promise<ModuleMapping | null> {
        try {
            // 查找匹配的路由信息
            const moduleInfo = this.findMatchingRoute(filePath);

            let moduleNames: string[];
            let finalRouteInfo: RouteConfig | undefined = moduleInfo;

            if (isRoot) {
                // 根目录文件处理
                moduleNames = moduleInfo?.name ? [moduleInfo.name] : [moduleName];
                this.rootModuleFileTags.set(dir, moduleNames);
            } else {
                // 非根目录文件处理
                const parentDir = path.dirname(dir);
                moduleNames = this.rootModuleFileTags.get(parentDir) || [];

                // 如果没有找到父级标签或标签不完整，尝试重新查找
                if (moduleNames.length === 0 || moduleNames.some(n => n.includes("·"))) {
                    finalRouteInfo = this.findMatchingRoute(filePath);
                    if (finalRouteInfo?.name) {
                        moduleNames = [finalRouteInfo.name];
                        this.rootModuleFileTags.set(dir, moduleNames);
                    } else {
                        moduleNames = [moduleName];
                    }
                }

                // 特殊路径处理
                if (filePath.includes(`${path.sep}user${path.sep}login`)) {
                    moduleNames = ['login'];
                }
            }

            // 分析文件依赖（可选，用于调试）
            try {
                const dependencyInfo = await this.parser.analyze(filePath);
                if (dependencyInfo && dependencyInfo.dependencies.length > 0) {
                    console.log(`File ${path.basename(filePath)} has ${dependencyInfo.dependencies.length} dependencies`);
                }
            } catch (error) {
                // 依赖分析失败不影响主要功能
                console.warn(`Failed to analyze dependencies for ${filePath}:`, error);
            }

            return {
                moduleNames: moduleNames.filter(Boolean),
                routePath: finalRouteInfo?.path || routePath,
                hideInMenu: finalRouteInfo?.hideInMenu || false,
                filePath,
                title: finalRouteInfo?.title || title || '',
                access: finalRouteInfo?.access || access || '',
            };
        } catch (error) {
            console.error(`Failed to create file mapping for ${filePath}:`, error);
            return null;
        }
    }

    /**
     * 查找匹配的路由信息
     * @param filePath 文件路径
     * @returns 匹配的路由配置
     */
    private findMatchingRoute(filePath: string): RouteConfig | undefined {
        const suffix = path.extname(filePath);
        const componentSourcePath = filePath.split(suffix)[0];

        return this.routes.find((route) => {
            if (!route.component) {
                return false;
            }

            let routeComponentPath = route.component;

            // 处理简单组件路径（如 ./Work）
            if (routeComponentPath.split(path.sep).length <= 2) {
                const fullPath = path.resolve(this.targetModulePath, routeComponentPath);
                return `${fullPath}${path.sep}index` === componentSourcePath;
            }

            // 处理index文件
            if (/^(.*)\/index\.(ts|tsx|jsx)$/g.test(filePath)) {
                const fullPath = path.resolve(this.targetModulePath, `${routeComponentPath}${path.sep}${path.basename(filePath).replace(suffix, '')}`);
                return fullPath === componentSourcePath;
            }

            // 直接路径匹配
            const fullPath = path.resolve(this.targetModulePath, routeComponentPath);
            return fullPath === componentSourcePath;
        });
    }




    /**
     * @description 解析组件相对文件夹目录
     * @param componentPath 组件相对路径 ./xxxx
     * @returns string: 输出xxx/src/pages/xxxx
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
        return this.relevantExtensions.some(ext => fileName.endsWith(ext));
    }

    /**
     * 处理文件变化
     */
    private async handleFileChange(): Promise<void> {
        try {
            this.logger.info('File change detected, clearing caches and re-analyzing...');

            // 清理缓存
            this.routeCache.clear();
            this.mappingCache.clear();
            this.parser.clearCache();

            // 重新分析
            await this.analyzeRoutes();

            this.logger.info('File change handled successfully');
        } catch (error) {
            this.logger.error('Failed to handle file change', error as Error);
        }
    }

    /**
     * 监听文件变化
     */
    private watchFileChanges(): void {
        // 清理现有的监听器
        this.disposeFileWatchers();

        try {
            // 监听路由文件变化
            const routeWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this.workspaceRoot, `**${path.sep}routes${path.sep}**${path.sep}*`)
            );

            // 监听模块文件变化
            const moduleWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this.workspaceRoot, `**${path.sep}src${path.sep}pages${path.sep}**${path.sep}*`)
            );

            // 监听配置文件变化
            const configWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this.workspaceRoot, `**${path.sep}{jsconfig,tsconfig}.json`)
            );

            // 注册事件处理器
            this.registerWatcherEvents(routeWatcher, 'route');
            this.registerWatcherEvents(moduleWatcher, 'module');
            this.registerWatcherEvents(configWatcher, 'config');

            // 保存监听器引用
            this.fileWatchers.push(routeWatcher, moduleWatcher, configWatcher);

            // 注册到context以便自动清理
            this.context.subscriptions.push(routeWatcher, moduleWatcher, configWatcher);

            this.logger.debug('File watchers initialized');
        } catch (error) {
            this.logger.error('Failed to initialize file watchers', error as Error);
        }
    }

    /**
     * 注册监听器事件
     * @param watcher 文件监听器
     * @param type 监听器类型
     */
    private registerWatcherEvents(watcher: vscode.FileSystemWatcher, type: string): void {
        watcher.onDidChange((uri) => {
            this.logger.debug(`${type} file changed: ${uri.fsPath}`);
            this.handleFileChange();
        });

        watcher.onDidCreate((uri) => {
            this.logger.debug(`${type} file created: ${uri.fsPath}`);
            this.handleFileChange();
        });

        watcher.onDidDelete((uri) => {
            this.logger.debug(`${type} file deleted: ${uri.fsPath}`);
            this.handleFileChange();
        });
    }

    /**
     * 清理文件监听器
     */
    private disposeFileWatchers(): void {
        this.fileWatchers.forEach(watcher => {
            try {
                watcher.dispose();
            } catch (error) {
                this.logger.warn('Failed to dispose file watcher', error as Error);
            }
        });
        this.fileWatchers = [];
    }

    /**
     * 获取文件对应的模块信息
     */
    public getModuleForFile(filePath: string): ModuleMapping | undefined {
        return this.moduleMappings.get(filePath);
    }

    /**
     * 获取缓存统计信息
     */
    public getCacheStats(): {
        routeCache: any;
        mappingCache: any;
        parserCache: any;
    } {
        return {
            routeCache: this.routeCache.getStats(),
            mappingCache: this.mappingCache.getStats(),
            parserCache: this.parser ? 'Available' : 'Not available'
        };
    }

    /**
     * 清理过期缓存
     */
    public cleanupCache(): void {
        const routeCleaned = this.routeCache.cleanup();
        const mappingCleaned = this.mappingCache.cleanup();

        this.logger.info('Cache cleanup completed', {
            routeCleaned,
            mappingCleaned
        });
    }

    /**
     * 销毁分析器，清理所有资源
     */
    public dispose(): void {
        this.logger.info('RouteAnalyzer disposing...');

        try {
            // 清理文件监听器
            this.disposeFileWatchers();

            // 清理缓存
            this.routeCache.clear();
            this.mappingCache.clear();
            this.parser.clearCache();

            // 清理映射数据
            this.moduleMappings.clear();
            this.rootModuleFileTags.clear();

            // 重置状态
            this.initStatus = false;
            this.routes = [];

            this.logger.info('RouteAnalyzer disposed successfully');
        } catch (error) {
            this.logger.error('Error during RouteAnalyzer disposal', error as Error);
        }
    }

    /**
     * 获取分析器状态信息
     */
    public getStatus(): {
        initialized: boolean;
        routesCount: number;
        mappingsCount: number;
        cacheStats: any;
        watchersCount: number;
    } {
        return {
            initialized: this.initStatus,
            routesCount: this.routes.length,
            mappingsCount: this.moduleMappings.size,
            cacheStats: this.getCacheStats(),
            watchersCount: this.fileWatchers.length
        };
    }
}