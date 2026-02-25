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
export interface ModuleMapping {
    moduleNames: string | string[];
    routePath: string;
    hideInMenu: boolean;
    filePath: string;
    title: string;
    access: string;
    dependencies: string[];   // 本文件依赖的模块内文件（绝对路径）
    dependents: string[];     // 依赖本文件的模块内文件（绝对路径）
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

    // 依赖关系图
    private fileDependencies: Map<string, string[]>;      // 文件 -> 其依赖的文件列表
    private fileReverseDependencies: Map<string, string[]>; // 文件 -> 依赖它的文件列表
    // 分析完成回调（文件监听触发重新分析时通知外部）
    private onAnalysisCompleteCallback: (() => void) | undefined;

    /**
     * @param workspaceRoot 该分析器对应的工作区文件夹根路径（绝对路径）
     * @param folderUri     对应的 WorkspaceFolder URI，用于读取该文件夹级别的插件配置
     *                      多根工作区下，不同文件夹可以分别配置 routeConfigPath 和 moduleSourceMapPath
     */
    constructor(context: vscode.ExtensionContext, workspaceRoot: string, folderUri?: vscode.Uri) {
        this.context = context;
        this.workspaceRoot = workspaceRoot;
        this.moduleMappings = new Map();
        this.rootModuleFileTags = new Map();
        this.iteratorDirArray = new WeakMap();
        this.routes = [];
        this.fileDependencies = new Map();
        this.fileReverseDependencies = new Map();
        this.relevantExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.json', '.d.ts', '.less', '.scss', '.css'];
        this.logger = Logger.getInstance();
        this.parser = new Parser(context, workspaceRoot);

        // 读取该文件夹独立的插件配置（多根工作区下每个文件夹可单独配置路径）
        const config = vscode.workspace.getConfiguration('extensionmodulemap', folderUri);
        const cacheMaxAge = config.get<number>('cacheMaxAge', 300000);
        const enableCache = config.get<boolean>('enableCache', true);

        this.routeCache = new CacheManager<RouteConfig[]>({
            maxAge: enableCache ? cacheMaxAge * 2 : 0,
            maxSize: 100
        });
        this.mappingCache = new CacheManager<ModuleMapping>({
            maxAge: enableCache ? cacheMaxAge : 0,
            maxSize: 1000
        });

        this.targetModulePath = path.join(
            workspaceRoot,
            config.get<string>('moduleSourceMapPath', '') || `.${path.sep}src${path.sep}pages`
        );
        this.routeFilePath = path.join(
            workspaceRoot,
            config.get<string>('routeConfigPath', '') || `.${path.sep}config${path.sep}routes.ts`
        );
    }

    public async checkRouteFileExists(): Promise<boolean> {
        const routeExists = await fs.access(this.routeFilePath).then(() => true).catch(() => false);
        const targetModuleExists = await fs.access(this.targetModulePath).then(() => true).catch(() => false);
        return routeExists && targetModuleExists;
    }

    public getInitStatus(): boolean {
        return this.initStatus;
    }

    /**
     * 注册分析完成回调，当文件监听触发重新分析完毕时调用
     */
    public setOnAnalysisCompleteCallback(callback: () => void): void {
        this.onAnalysisCompleteCallback = callback;
    }

    public async initialize(): Promise<void> {
        try {
            this.logger.info('Initializing route analyzer...');

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
            this.fileDependencies.clear();
            this.fileReverseDependencies.clear();

            await this.analyzeRoutes();

            this.logger.info('Route analyzer initialized successfully', {
                routesCount: this.routes.length,
                mappingsCount: this.moduleMappings.size
            });

            this.initStatus = true;
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

            await this.parser.initBeforeParseConfig();

            const content = await fs.readFile(this.routeFilePath, 'utf-8');
            const checksum = this.calculateChecksum(content);
            this.logger.debug('Route file loaded', { size: content.length, checksum });

            const cacheKey = `routes_${this.routeFilePath}`;
            const cachedRoutes = await this.routeCache.get(cacheKey);

            if (cachedRoutes) {
                this.routes = cachedRoutes;
                this.logger.debug('Routes loaded from cache', { routesCount: this.routes.length });
            } else {
                await this.parseRoutesWithAST(content);
                this.logger.debug('Routes parsed with AST', { routesCount: this.routes.length });
                await this.routeCache.set(cacheKey, this.routes, '1.0.0', checksum);
            }

            await this.buildModuleMappings();
            this.logger.debug('Module mappings built', { mappingsCount: this.moduleMappings.size });

            // 建立文件依赖关系图
            await this.buildDependencyGraph();
            this.logger.debug('Dependency graph built');

        } catch (error) {
            this.logger.error('Failed to analyze routes', error as Error);
            throw error;
        }
    }

    private calculateChecksum(content: string): string {
        return crypto.createHash('md5').update(content).digest('hex');
    }

    /**
     * 使用 AST 解析路由配置，支持 spread 展开引用外部文件的情况
     */
    private async parseRoutesWithAST(content: string): Promise<void> {
        try {
            this.logger.debug('Parsing routes with AST...');

            const ast = parser.parse(content, {
                sourceType: 'module',
                plugins: ['typescript', 'jsx'],
                allowImportExportEverywhere: true,
                allowReturnOutsideFunction: true,
            });

            // 第一步：同步收集所有 import 和 export default 节点
            const imports = new Map<string, string>(); // localName -> importSource
            let exportDefaultNode: any = null;
            let exportDefaultScope: any = null;

            // @ts-ignore
            traverse(ast, {
                ImportDeclaration: (nodePath: any) => {
                    for (const spec of nodePath.node.specifiers) {
                        imports.set(spec.local.name, nodePath.node.source.value);
                    }
                },
                ExportDefaultDeclaration: (nodePath: any) => {
                    exportDefaultNode = nodePath.node.declaration;
                    exportDefaultScope = nodePath.scope;
                }
            });

            if (!exportDefaultNode) {
                this.logger.warn('No export default found, falling back to regex parsing');
                await this.deepParseRouteConfig(content);
                return;
            }

            let routesFound = false;

            if (exportDefaultNode.type === 'ArrayExpression') {
                this.routes = await this.extractRoutesFromArrayAsync(exportDefaultNode, imports);
                routesFound = true;
                this.logger.debug('Found direct array export with spread support');
            } else if (exportDefaultNode.type === 'Identifier') {
                const binding = exportDefaultScope?.getBinding(exportDefaultNode.name);
                if (binding && binding.path.node.type === 'VariableDeclarator') {
                    const init = binding.path.node.init;
                    if (init && init.type === 'ArrayExpression') {
                        this.routes = await this.extractRoutesFromArrayAsync(init, imports);
                        routesFound = true;
                        this.logger.debug('Found variable array export with spread support');
                    }
                }
            }

            if (!routesFound) {
                this.logger.warn('No routes found in AST, falling back to regex parsing');
                await this.deepParseRouteConfig(content);
            }
        } catch (error) {
            this.logger.error('Failed to parse routes with AST, falling back to regex parsing', error as Error);
            await this.deepParseRouteConfig(content);
        }
    }

    /**
     * 支持 SpreadElement 的异步路由数组提取
     * 当遇到 ...importedRoutes 时，读取对应文件并递归解析
     */
    private async extractRoutesFromArrayAsync(
        arrayExpression: any,
        imports: Map<string, string>
    ): Promise<RouteConfig[]> {
        const routes: RouteConfig[] = [];

        for (const element of arrayExpression.elements) {
            if (!element) continue;

            if (element.type === 'ObjectExpression') {
                const route = this.extractRouteFromObject(element);
                if (route) {
                    if (route.routes && route.routes.length > 0) {
                        routes.push(...route.routes);
                    } else if (route.path && route.component) {
                        routes.push(route);
                    }
                }
            } else if (element.type === 'SpreadElement') {
                if (element.argument.type === 'Identifier') {
                    const varName = element.argument.name;
                    const importSource = imports.get(varName);
                    if (importSource) {
                        const importedRoutes = await this.loadAndParseImportedRoutes(importSource);
                        routes.push(...importedRoutes);
                        this.logger.debug(`Resolved spread import: ${varName} -> ${importSource} (${importedRoutes.length} routes)`);
                    }
                }
            }
        }

        return routes;
    }

    /**
     * 加载并解析被 spread 引用的路由文件
     */
    private async loadAndParseImportedRoutes(importSource: string): Promise<RouteConfig[]> {
        try {
            const routeDir = path.dirname(this.routeFilePath);
            const resolvedPath = await this.resolveRouteImportFile(importSource, routeDir);
            if (!resolvedPath) {
                this.logger.warn(`Cannot resolve imported route file: ${importSource}`);
                return [];
            }

            const content = await fs.readFile(resolvedPath, 'utf-8');
            return this.parseImportedRoutesFile(content);
        } catch (error) {
            this.logger.warn(`Failed to load imported routes from ${importSource}`, error as Error);
            return [];
        }
    }

    /**
     * 解析相对于路由目录的 import 路径为真实文件路径
     */
    private async resolveRouteImportFile(importSource: string, fromDir: string): Promise<string | null> {
        if (!importSource.startsWith('.')) {
            return null; // 跳过 node_modules 等非相对路径
        }
        const extensions = ['.ts', '.tsx', '.js', '.jsx'];
        const basePath = path.resolve(fromDir, importSource);

        for (const ext of extensions) {
            const filePath = basePath + ext;
            try {
                await fs.access(filePath);
                return filePath;
            } catch { /* 继续尝试 */ }
        }

        for (const ext of extensions) {
            const indexPath = path.join(basePath, `index${ext}`);
            try {
                await fs.access(indexPath);
                return indexPath;
            } catch { /* 继续尝试 */ }
        }

        return null;
    }

    /**
     * 解析子路由文件的 export default 数组（同步版，不处理进一步的 spread）
     */
    private parseImportedRoutesFile(content: string): RouteConfig[] {
        try {
            const cleanContent = this.removeComments(content);
            const ast = parser.parse(cleanContent, {
                sourceType: 'module',
                plugins: ['typescript', 'jsx'],
                allowImportExportEverywhere: true,
                allowReturnOutsideFunction: true,
            });

            let exportDefaultNode: any = null;
            let exportDefaultScope: any = null;

            // @ts-ignore
            traverse(ast, {
                ExportDefaultDeclaration: (nodePath: any) => {
                    exportDefaultNode = nodePath.node.declaration;
                    exportDefaultScope = nodePath.scope;
                }
            });

            if (!exportDefaultNode) return [];

            if (exportDefaultNode.type === 'ArrayExpression') {
                return this.extractRoutesFromArray(exportDefaultNode);
            }

            if (exportDefaultNode.type === 'Identifier') {
                const binding = exportDefaultScope?.getBinding(exportDefaultNode.name);
                if (binding?.path?.node?.type === 'VariableDeclarator') {
                    const init = binding.path.node.init;
                    if (init?.type === 'ArrayExpression') {
                        return this.extractRoutesFromArray(init);
                    }
                }
            }

            return [];
        } catch {
            return [];
        }
    }

    /**
     * 同步版本：从 AST 数组中提取路由（用于嵌套子路由和子文件解析）
     */
    private extractRoutesFromArray(arrayExpression: any): RouteConfig[] {
        const routes: RouteConfig[] = [];

        for (const element of arrayExpression.elements) {
            if (element && element.type === 'ObjectExpression') {
                const route = this.extractRouteFromObject(element);
                if (route) {
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
     * 从 AST 对象表达式中提取单个路由配置
     */
    private extractRouteFromObject(objectExpression: any): RouteConfig | null {
        const route: RouteConfig = {};

        for (const property of objectExpression.properties) {
            if (property.type === 'ObjectProperty' && property.key.type === 'Identifier') {
                const key = property.key.name;
                const value = property.value;

                switch (key) {
                    case 'path':
                        if (value.type === 'StringLiteral') route.path = value.value;
                        break;
                    case 'name':
                        if (value.type === 'StringLiteral') route.name = value.value;
                        break;
                    case 'component':
                        if (value.type === 'StringLiteral') route.component = value.value;
                        break;
                    case 'access':
                        if (value.type === 'StringLiteral') route.access = value.value;
                        break;
                    case 'title':
                        if (value.type === 'StringLiteral') route.title = value.value;
                        break;
                    case 'icon':
                        if (value.type === 'StringLiteral') route.icon = value.value;
                        break;
                    case 'hideInMenu':
                        if (value.type === 'BooleanLiteral') route.hideInMenu = value.value;
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

    private parseRouteObject(str: string): RouteConfig | null {
        const route: RouteConfig = {};

        const pathMatch = str.match(/path:\s*['"]([^'"]+)['"]/);
        if (pathMatch) { route.path = pathMatch[1]; }

        const nameMatch = str.match(/name:\s*['"]([^'"]+)['"]/);
        if (nameMatch) { route.name = nameMatch[1]; }

        const componentMatch = str.match(/component:\s*['"]([^'"]+)['"]/);
        if (componentMatch) { route.component = componentMatch[1]; }

        const accessMatch = str.match(/access:\s*['"]([^'"]+)['"]/);
        if (accessMatch) { route.access = accessMatch[1]; }

        const titleMatch = str.match(/title:\s*['"]([^'"]+)['"]/);
        if (titleMatch) { route.title = titleMatch[1]; }

        const iconMatch = str.match(/icon:\s*['"]([^'"]+)['"]/);
        if (iconMatch) { route.icon = iconMatch[1]; }

        const hideInMenuMatch = str.match(/hideInMenu:\s*(true|false)/);
        if (hideInMenuMatch) { route.hideInMenu = hideInMenuMatch[1] === 'true'; }

        return Object.keys(route).length > 0 ? route : null;
    }

    private parseAndFlattenRoutes(str: string): RouteConfig[] {
        const flatRoutes: RouteConfig[] = [];
        const routeObjects = this.extractRouteObjects(str);

        for (const routeStr of routeObjects) {
            const nestedRoutesMatch = routeStr.match(/routes:\s*\[([^[\]]*(?:\[(?:[^[\]]*(?:\[[^[\]]*\][^[\]]*)*)\][^[\]]*)*)\]/);
            if (nestedRoutesMatch) {
                const nestedRoutes = this.parseAndFlattenRoutes(nestedRoutesMatch[1]);
                flatRoutes.push(...nestedRoutes);
            } else {
                const route = this.parseRouteObject(routeStr);
                if (route && route.path && route.component) {
                    flatRoutes.push(route);
                }
            }
        }

        return flatRoutes;
    }

    private removeComments = (str: string): string => {
        return str
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*/g, '')
            .replace(/^\s*[\r\n]/gm, '')
            .replace(/,(\s*[}\]])/g, '$1')
            .replace(/\s+/g, ' ')
            .trim();
    };

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

    private async deepParseRouteConfig(content: string) {
        try {
            const cleanContent = this.removeComments(content);
            const exportMatch = cleanContent.match(/export\s+default\s*\[([\s\S]*)\]/);
            if (!exportMatch) { return []; }
            this.routes = this.parseAndFlattenRoutes(exportMatch[1]);
        } catch (error) {
            console.error('Failed to parse route config:', error);
            return error;
        }
    }

    private extractModuleName(componentPath: string): string {
        const pathParts = componentPath.split(path.sep);
        return `${pathParts[0]}${path.sep}${pathParts[1]}`;
    }

    private async buildModuleMappings(): Promise<void> {
        const startTime = Date.now();
        let processedCount = 0;
        let errorCount = 0;

        this.logger.debug('Building module mappings...', { routesCount: this.routes.length });

        const concurrencyLimit = 5;
        const chunks = this.chunkArray(this.routes, concurrencyLimit);

        for (const chunk of chunks) {
            const promises = chunk.map(async (route) => {
                try {
                    if (route.component) {
                        const moduleDirName = this.extractModuleName(route.component);
                        const componentPath = this.resolveComponentPath(moduleDirName);

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
     * 建立文件依赖关系图（正向依赖 + 反向依赖）
     * 只统计模块内部文件之间的依赖，过滤掉 node_modules 等外部依赖
     */
    private async buildDependencyGraph(): Promise<void> {
        this.fileDependencies.clear();
        this.fileReverseDependencies.clear();

        const allFiles = Array.from(this.moduleMappings.keys());
        const allFilesSet = new Set(allFiles);

        // 构建正向依赖
        for (const filePath of allFiles) {
            try {
                const deps = await this.parser.getDependencies(filePath);
                const localDeps = deps.filter(dep => allFilesSet.has(dep));
                this.fileDependencies.set(filePath, localDeps);
            } catch {
                this.fileDependencies.set(filePath, []);
            }
        }

        // 从正向依赖推导反向依赖
        for (const [filePath, deps] of this.fileDependencies) {
            for (const dep of deps) {
                if (!this.fileReverseDependencies.has(dep)) {
                    this.fileReverseDependencies.set(dep, []);
                }
                this.fileReverseDependencies.get(dep)!.push(filePath);
            }
        }

        // 将依赖信息写入 moduleMappings
        for (const [filePath, mapping] of this.moduleMappings) {
            mapping.dependencies = this.fileDependencies.get(filePath) || [];
            mapping.dependents = this.fileReverseDependencies.get(filePath) || [];
        }

        this.logger.debug('Dependency graph built', {
            filesWithDeps: this.fileDependencies.size,
            filesWithDependents: this.fileReverseDependencies.size
        });
    }

    private chunkArray<T>(array: T[], chunkSize: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    private async mapModuleFiles(dir: string, moduleName: string, routePath: string, componentPath: string, title: string, access: string, isRoot: boolean) {
        try {
            const dirExists = await fs.access(dir).then(() => true).catch(() => false);
            if (!dirExists) {
                return;
            }

            const files = await fs.readdir(dir, { withFileTypes: true });

            for (const file of files) {
                const filePath = path.join(dir, file.name);

                if (file.isDirectory()) {
                    if (!this.iteratorDirArray.get(this)?.includes(filePath)) {
                        this.iteratorDirArray.set(this, [...this.iteratorDirArray.get(this) || [], filePath]);
                        await this.mapModuleFiles(filePath, moduleName, routePath, componentPath, title, access, false);
                    }
                } else if (this.isRelevantFile(file.name) && !this.moduleMappings.has(filePath)) {
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
            const moduleInfo = this.findMatchingRoute(filePath);

            let moduleNames: string[];
            let finalRouteInfo: RouteConfig | undefined = moduleInfo;

            if (isRoot) {
                moduleNames = moduleInfo?.name ? [moduleInfo.name] : [moduleName];
                this.rootModuleFileTags.set(dir, moduleNames);
            } else {
                const parentDir = path.dirname(dir);
                moduleNames = this.rootModuleFileTags.get(parentDir) || [];

                if (moduleNames.length === 0 || moduleNames.some(n => n.includes("·"))) {
                    finalRouteInfo = this.findMatchingRoute(filePath);
                    if (finalRouteInfo?.name) {
                        moduleNames = [finalRouteInfo.name];
                        this.rootModuleFileTags.set(dir, moduleNames);
                    } else {
                        moduleNames = [moduleName];
                    }
                }

                if (filePath.includes(`${path.sep}user${path.sep}login`)) {
                    moduleNames = ['login'];
                }
            }

            return {
                moduleNames: moduleNames.filter(Boolean),
                routePath: finalRouteInfo?.path || routePath,
                hideInMenu: finalRouteInfo?.hideInMenu || false,
                filePath,
                title: finalRouteInfo?.title || title || '',
                access: finalRouteInfo?.access || access || '',
                dependencies: [],  // 由 buildDependencyGraph 填充
                dependents: [],    // 由 buildDependencyGraph 填充
            };
        } catch (error) {
            console.error(`Failed to create file mapping for ${filePath}:`, error);
            return null;
        }
    }

    /**
     * 查找与文件路径精确匹配的路由信息
     * 修复：统一使用 path.sep 处理路径分隔符，避免跨平台不一致
     */
    private findMatchingRoute(filePath: string): RouteConfig | undefined {
        const suffix = path.extname(filePath);
        const componentSourcePath = filePath.split(suffix)[0];

        return this.routes.find((route) => {
            if (!route.component) {
                return false;
            }

            // 统一将路由 component 路径中的 '/' 替换为系统分隔符
            const normalizedComponent = route.component.replace(/\//g, path.sep);
            const pathParts = normalizedComponent.split(path.sep);

            // 处理简单路径（如 ./Work）：拼接 index 后匹配
            if (pathParts.length <= 2) {
                const fullPath = path.resolve(this.targetModulePath, normalizedComponent);
                return `${fullPath}${path.sep}index` === componentSourcePath;
            }

            // 处理 index 文件（如 ModuleName/SubPage/index.tsx）
            if (/index\.(ts|tsx|jsx|js)$/.test(filePath)) {
                const fullPath = path.resolve(
                    this.targetModulePath,
                    `${normalizedComponent}${path.sep}${path.basename(filePath).replace(suffix, '')}`
                );
                return fullPath === componentSourcePath;
            }

            // 直接路径匹配
            const fullPath = path.resolve(this.targetModulePath, normalizedComponent);
            return fullPath === componentSourcePath;
        });
    }

    private resolveComponentPath(componentPath: string): string {
        if (componentPath.startsWith('@')) {
            return path.join(this.targetModulePath, componentPath.slice(2));
        }
        return path.join(this.targetModulePath, componentPath);
    }

    private isRelevantFile(fileName: string): boolean {
        return this.relevantExtensions.some(ext => fileName.endsWith(ext));
    }

    private async handleFileChange(): Promise<void> {
        try {
            this.logger.info('File change detected, clearing caches and re-analyzing...');

            this.routeCache.clear();
            this.mappingCache.clear();
            this.parser.clearCache();

            // 清空旧数据
            this.moduleMappings.clear();
            this.routes = [];
            this.fileDependencies.clear();
            this.fileReverseDependencies.clear();

            await this.analyzeRoutes();

            this.logger.info('File change handled successfully');

            // 通知外部（ExtensionManager）刷新状态栏
            this.onAnalysisCompleteCallback?.();
        } catch (error) {
            this.logger.error('Failed to handle file change', error as Error);
        }
    }

    private watchFileChanges(): void {
        this.disposeFileWatchers();

        try {
            const routeWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this.workspaceRoot, `**${path.sep}routes${path.sep}**${path.sep}*`)
            );

            const moduleWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this.workspaceRoot, `**${path.sep}src${path.sep}pages${path.sep}**${path.sep}*`)
            );

            const configWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this.workspaceRoot, `**${path.sep}{jsconfig,tsconfig}.json`)
            );

            this.registerWatcherEvents(routeWatcher, 'route');
            this.registerWatcherEvents(moduleWatcher, 'module');
            this.registerWatcherEvents(configWatcher, 'config');

            this.fileWatchers.push(routeWatcher, moduleWatcher, configWatcher);
            this.context.subscriptions.push(routeWatcher, moduleWatcher, configWatcher);

            this.logger.debug('File watchers initialized');
        } catch (error) {
            this.logger.error('Failed to initialize file watchers', error as Error);
        }
    }

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

    public getModuleForFile(filePath: string): ModuleMapping | undefined {
        return this.moduleMappings.get(filePath);
    }

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

    public cleanupCache(): void {
        const routeCleaned = this.routeCache.cleanup();
        const mappingCleaned = this.mappingCache.cleanup();

        this.logger.info('Cache cleanup completed', {
            routeCleaned,
            mappingCleaned
        });
    }

    public dispose(): void {
        this.logger.info('RouteAnalyzer disposing...');

        try {
            this.disposeFileWatchers();
            this.routeCache.clear();
            this.mappingCache.clear();
            this.parser.clearCache();
            this.moduleMappings.clear();
            this.rootModuleFileTags.clear();
            this.fileDependencies.clear();
            this.fileReverseDependencies.clear();
            this.initStatus = false;
            this.routes = [];

            this.logger.info('RouteAnalyzer disposed successfully');
        } catch (error) {
            this.logger.error('Error during RouteAnalyzer disposal', error as Error);
        }
    }

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
