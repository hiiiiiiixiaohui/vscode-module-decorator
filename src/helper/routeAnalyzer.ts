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
    private visitedDirs: Set<string>;
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

    // 防抖与并发防护：分支切换等批量文件变更会短时间内触发大量事件，
    // 需将多次触发合并为一次分析，并防止多轮分析并发执行
    private debounceTimer: any;
    private isAnalyzing: boolean = false;
    private pendingReanalysis: boolean = false;

    /**
     * @param workspaceRoot 该分析器对应的工作区文件夹根路径（绝对路径）
     * @param folderUri     对应的 WorkspaceFolder URI，用于读取该文件夹级别的插件配置
     *                      多根工作区下，不同文件夹可以分别配置 routeConfigPath 和 moduleSourceMapPath
     */
    constructor(context: vscode.ExtensionContext, workspaceRoot: string, folderUri?: vscode.Uri) {
        this.context = context;
        this.workspaceRoot = workspaceRoot;
        this.moduleMappings = new Map();
        this.visitedDirs = new Set();
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

            // 利用依赖图将路由模块名传播到所有关联文件
            this.propagateModuleNamesViaDependencies();
            this.logger.debug('Module names propagated via dependency graph');

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
            this.logger.error('Failed to parse route config', error as Error);
            return error;
        }
    }

    /**
     * 从路由 component 路径中提取模块根目录名
     * 路由配置中 component 通常使用 / 分隔（如 Work/SubPage/index 或 ./Work/SubPage），
     * 始终返回第一级有意义的目录，避免只扫描子目录而遗漏模块根目录下的公共文件。
     *
     * 示例：
     *   Work/SubPage/index  → Work
     *   ./Work/SubPage      → ./Work
     *   @/Work/SubPage      → @/Work
     */
    private extractModuleName(componentPath: string): string {
        const normalized = componentPath.replace(/\\/g, '/');
        const parts = normalized.split('/').filter(Boolean);

        if (parts.length === 0) {
            return componentPath;
        }

        if (parts[0] === '.') {
            return parts.length >= 2 ? `./${parts[1]}` : '.';
        }

        if (parts[0].startsWith('@')) {
            return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
        }

        return parts[0];
    }

    private async buildModuleMappings(): Promise<void> {
        const startTime = Date.now();
        let processedCount = 0;
        let errorCount = 0;

        // 每次重新构建前清空访问记录，确保重新分析时数据干净
        this.visitedDirs.clear();

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
                                route.title || '',
                                route.access || '',
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
     * parser.getDependencies 已在内部过滤掉 node_modules 和未解析的裸模块名，
     * 此处再用 allFilesSet 二次过滤，确保依赖图中只保留本次分析范围内的源文件。
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
                // 过滤到模块范围内的文件并去重：同一文件被多条 import 语句引用时，
                // parser 可能返回重复路径，若不去重会在 fileReverseDependencies 中产生重复的 dependents 条目
                const localDeps = [...new Set(deps.filter(dep => allFilesSet.has(dep)))];
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

    /**
     * 依赖图传播：以"直接路由匹配的文件"为种子，沿 import 方向（dependencies）单向传播。
     * 为每个文件计算到各路由入口的最短 import 跳数，按跳数优先级同步更新全部路由字段。
     *
     * 【只沿 dependencies 方向传播，不走 dependents 方向】
     * - 路由"拥有"它所 import 的文件（dependencies）：语义正确
     * - 路由不"拥有"import 了它的文件（dependents）：那些是 Layout、父路由等，不属于该路由
     *
     * 赋值规则（以跳数最小的路由为"主路由"）：
     *   moduleNames  → 0跳或唯一可达时写入单个名称；多路由可达时取前 MAX_ROUTE_NAMES 个
     *   routePath    → 主路由的页面路由路径
     *   title        → 主路由的菜单标题
     *   access       → 主路由的权限标识
     *   hideInMenu   → 主路由的菜单隐藏配置
     *
     * 无任何路由可达的文件：保留目录扫描阶段的初始值作为兜底
     * 传播范围：仅限 moduleMappings 内的文件（buildDependencyGraph 已过滤外部依赖）
     */
    private propagateModuleNamesViaDependencies(): void {
        const MAX_ROUTE_NAMES = 3;

        // filePath → Map<routeName, { route: RouteConfig; hops: number }>
        // 存储完整路由配置，便于最终同步所有字段
        const candidateMap = new Map<string, Map<string, { route: RouteConfig; hops: number }>>();
        for (const filePath of this.moduleMappings.keys()) {
            candidateMap.set(filePath, new Map());
        }

        let seedCount = 0;

        for (const [filePath] of this.moduleMappings) {
            const route = this.findMatchingRoute(filePath);
            if (!route?.name) {
                continue;
            }
            seedCount++;

            const routeName = route.name;

            // BFS：只沿 dependencies 方向（import 树），记录每个文件的最短跳数
            const distMap = new Map<string, number>();
            const queue: Array<[string, number]> = [[filePath, 0]];

            while (queue.length > 0) {
                const [current, hops] = queue.shift()!;
                if (distMap.has(current)) {
                    continue;
                }
                distMap.set(current, hops);

                const mapping = this.moduleMappings.get(current);
                if (!mapping) {
                    continue;
                }

                // 只跟随 dependencies（当前文件 import 了哪些文件），
                // 不跟随 dependents（谁 import 了当前文件），避免污染上层文件的归属
                for (const dep of mapping.dependencies) {
                    if (!distMap.has(dep)) {
                        queue.push([dep, hops + 1]);
                    }
                }
            }

            // 将本次 BFS 结果合并到 candidateMap（同一路由保留最短跳数）
            for (const [fp, hops] of distMap) {
                const fileMap = candidateMap.get(fp);
                if (!fileMap) {
                    continue;
                }
                const prev = fileMap.get(routeName);
                if (prev === undefined || hops < prev.hops) {
                    fileMap.set(routeName, { route, hops });
                }
            }
        }

        this.logger.debug('Propagation seeds collected', { seedCount });

        for (const [filePath, mapping] of this.moduleMappings) {
            const fileMap = candidateMap.get(filePath);
            if (!fileMap || fileMap.size === 0) {
                // 无任何路由可达：保留目录扫描阶段的初始值作为兜底
                continue;
            }

            // 按跳数升序排列，跳数最小的为主路由
            const sorted = Array.from(fileMap.values()).sort((a, b) => a.hops - b.hops);
            const minHops = sorted[0].hops;

            // 确定纳入 moduleNames 的路由列表
            const topEntries = (minHops === 0 || sorted.length === 1)
                ? [sorted[0]]
                : sorted.slice(0, MAX_ROUTE_NAMES);

            // 主路由（跳数最小）负责同步所有路由字段
            const primary = sorted[0].route;

            mapping.moduleNames = topEntries.map(e => e.route.name!).filter(Boolean);
            mapping.routePath   = primary.path      ?? mapping.routePath;
            mapping.title       = primary.title     ?? mapping.title;
            mapping.access      = primary.access    ?? mapping.access;
            mapping.hideInMenu  = primary.hideInMenu ?? mapping.hideInMenu;
        }

        this.logger.debug('Module names propagation completed', {
            propagatedFiles: this.moduleMappings.size
        });
    }

    private chunkArray<T>(array: T[], chunkSize: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    private async mapModuleFiles(dir: string, moduleName: string, routePath: string, title: string, access: string) {
        try {
            const dirExists = await fs.access(dir).then(() => true).catch(() => false);
            if (!dirExists) {
                return;
            }

            const files = await fs.readdir(dir, { withFileTypes: true });

            for (const file of files) {
                const filePath = path.join(dir, file.name);

                if (file.isDirectory()) {
                    // 每个目录只扫描一次：目录扫描阶段仅负责"发现文件并赋予初始模块名"，
                    // 不再为不同路由重复遍历同一目录来堆积模块名。
                    // 多路由共享文件的模块归属由 propagateModuleNamesViaDependencies 阶段
                    // 依据真实 import 依赖关系来确定，避免同目录下 N 条路由积累出 N 个模块名。
                    if (!this.visitedDirs.has(filePath)) {
                        this.visitedDirs.add(filePath);
                        await this.mapModuleFiles(filePath, moduleName, routePath, title, access);
                    }
                } else if (this.isRelevantFile(file.name)) {
                    if (!this.moduleMappings.has(filePath)) {
                        // 首次遇到该文件：创建映射并写入初始模块名
                        const mapping = await this.createFileMapping(filePath, moduleName, routePath, title, access);
                        if (mapping) {
                            this.moduleMappings.set(filePath, mapping);
                        }
                    }
                    // 已存在于映射中的文件：不再追加模块名。
                    // 传播阶段（propagateModuleNamesViaDependencies）会根据实际 import 路径
                    // 为共享文件重新分配准确的模块名，此处追加只会引入冗余。
                }
            }
        } catch (error) {
            this.logger.error(`Failed to map files in directory ${dir}`, error as Error);
        }
    }

    private async createFileMapping(
        filePath: string,
        moduleName: string,
        routePath: string,
        title: string,
        access: string,
    ): Promise<ModuleMapping | null> {
        try {
            const moduleInfo = this.findMatchingRoute(filePath);
            const finalRouteInfo: RouteConfig | undefined = moduleInfo;
            let moduleNames: string[];

            if (moduleInfo?.name) {
                // 文件精确匹配某个路由，直接使用该路由的 name
                moduleNames = [moduleInfo.name];
            } else {
                // 根目录或子目录下的非路由文件，统一使用当前扫描路径对应的路由名作为初始值。
                // visitedDirs 已保证每个目录只被第一个到达的路由扫描一次，
                // 因此 moduleName 在此处是唯一的、确定性的（不会因多条路由重复访问而堆积）。
                // 传播阶段（propagateModuleNamesViaDependencies）会根据真实 import 关系重新赋值；
                // 对于无法被 BFS 到达的文件（如未被任何文件 import 的 .d.ts 声明文件），
                // 此处的单一名称作为兜底，避免出现十几个路由名堆积的情况。
                moduleNames = [moduleName];
            }

            if (filePath.includes(`${path.sep}user${path.sep}login`)) {
                moduleNames = ['login'];
            }

            return {
                moduleNames: moduleNames.filter(Boolean),
                routePath: finalRouteInfo?.path || routePath,
                hideInMenu: finalRouteInfo?.hideInMenu || false,
                filePath,
                title: finalRouteInfo?.title || title || '',
                access: finalRouteInfo?.access || access || '',
                dependencies: [],
                dependents: [],
            };
        } catch (error) {
            this.logger.error(`Failed to create file mapping for ${filePath}`, error as Error);
            return null;
        }
    }

    /**
     * 将路由 component 字符串（使用 / 分隔，可含 @/、./ 前缀）转换为系统绝对路径（不含扩展名）
     * 统一在此处理所有前缀，供 findMatchingRoute 和 resolveComponentPath 共同使用
     */
    private componentToAbsPath(component: string): string {
        // 统一为 / 分隔，兼容 Windows 路由配置中偶尔出现的 \
        let normalized = component.replace(/\\/g, '/');

        if (normalized.startsWith('@/')) {
            normalized = normalized.slice(2);
        } else if (normalized.startsWith('./')) {
            normalized = normalized.slice(2);
        }

        // path.join 会自动处理系统路径分隔符
        return path.join(this.targetModulePath, normalized);
    }

    /**
     * 查找与文件路径精确匹配的路由信息
     *
     * 支持两种匹配模式：
     *   A. 直接匹配：component = 'Work/SubPage/index' 或 'Work/SubPage/SomePage'
     *      → 去掉文件扩展名后与 component 绝对路径相等
     *   B. 目录 index 匹配：component = 'Work/SubPage'（指向目录）
     *      → 实际文件为 Work/SubPage/index.tsx
     */
    private findMatchingRoute(filePath: string): RouteConfig | undefined {
        const ext = path.extname(filePath);
        // 用 slice 而非 split，避免路径中包含扩展名字符串导致误分割
        const fileBasePath = filePath.slice(0, filePath.length - ext.length);

        return this.routes.find((route) => {
            if (!route.component) {
                return false;
            }

            const resolvedBase = this.componentToAbsPath(route.component);

            // 模式 A：去掉扩展名后直接相等
            if (fileBasePath === resolvedBase) {
                return true;
            }

            // 模式 B：component 指向目录，实际文件是该目录下的 index 文件
            if (path.basename(fileBasePath) === 'index') {
                return fileBasePath === path.join(resolvedBase, 'index');
            }

            return false;
        });
    }

    private resolveComponentPath(componentPath: string): string {
        // componentPath 来自 extractModuleName，格式为 Work、./Work 或 @/Work
        // 直接复用 componentToAbsPath 统一处理，path.join 会正确处理 ./ 前缀
        if (componentPath.startsWith('@/')) {
            return path.join(this.targetModulePath, componentPath.slice(2));
        }
        return path.join(this.targetModulePath, componentPath);
    }

    private isRelevantFile(fileName: string): boolean {
        return this.relevantExtensions.some(ext => fileName.endsWith(ext));
    }

    /**
     * 文件变更入口：仅负责防抖调度，不直接执行分析。
     * 分支切换等场景会短时间内连续触发大量事件，防抖确保最后一次变更后
     * 600ms 内无新事件才真正启动分析，将 N 次触发合并为一次。
     */
    private handleFileChange(): void {
        if (this.debounceTimer) {
            (globalThis as any).clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = (globalThis as any).setTimeout(() => this.executeReanalysis(), 600);
    }

    /**
     * 真正执行重新分析的方法，含两层保护：
     *
     * 1. 并发防护：若上一轮分析尚未结束，仅标记 pendingReanalysis，
     *    上一轮结束后自动触发下一轮，不会有多个 analyzeRoutes 同时运行。
     *
     * 2. 快照回滚：分析前将当前有效数据保存为快照，切换到新容器执行分析；
     *    分析成功则新数据生效，失败则恢复快照，保证任何情况下都有完整数据可用。
     */
    private async executeReanalysis(): Promise<void> {
        this.debounceTimer = undefined;

        if (this.isAnalyzing) {
            // 有分析正在进行，打标记，当前轮结束后会自动再触发一次
            this.pendingReanalysis = true;
            return;
        }

        this.isAnalyzing = true;
        this.pendingReanalysis = false;
        this.logger.info('Re-analyzing routes (triggered by file change)...');

        this.routeCache.clear();
        this.mappingCache.clear();
        this.parser.clearCache();

        // 保存当前有效数据的快照引用（不做深拷贝，只保留对象引用）
        const snapshot = {
            routes: this.routes,
            moduleMappings: this.moduleMappings,
            fileDependencies: this.fileDependencies,
            fileReverseDependencies: this.fileReverseDependencies,
        };

        // 切换到全新容器：analyzeRoutes 及其子流程均写入新容器，
        // 旧容器数据在快照中保留，分析期间外部读取仍可访问旧数据
        this.routes = [];
        this.moduleMappings = new Map();
        this.fileDependencies = new Map();
        this.fileReverseDependencies = new Map();

        try {
            await this.analyzeRoutes();
            this.logger.info('Re-analysis completed successfully', {
                routesCount: this.routes.length,
                mappingsCount: this.moduleMappings.size
            });
            this.onAnalysisCompleteCallback?.();
        } catch (error) {
            // 分析失败（如分支切换导致文件临时不存在）：恢复快照，保留上一次有效数据
            this.logger.warn('Re-analysis failed, restoring previous valid state', error as Error);
            this.routes = snapshot.routes;
            this.moduleMappings = snapshot.moduleMappings;
            this.fileDependencies = snapshot.fileDependencies;
            this.fileReverseDependencies = snapshot.fileReverseDependencies;
        } finally {
            this.isAnalyzing = false;
            if (this.pendingReanalysis) {
                // 分析期间又有新的文件变更，重新调度一次
                this.pendingReanalysis = false;
                this.handleFileChange();
            }
        }
    }

    private watchFileChanges(): void {
        this.disposeFileWatchers();

        try {
            // VS Code glob pattern 固定使用 /，不能用 path.sep（Windows 上 path.sep 为 \）
            const routeWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this.workspaceRoot, '**/routes/**/*')
            );

            const moduleWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this.workspaceRoot, '**/src/pages/**/*')
            );

            const configWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this.workspaceRoot, '**/{jsconfig,tsconfig}.json')
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
            if (this.debounceTimer) {
                (globalThis as any).clearTimeout(this.debounceTimer);
                this.debounceTimer = undefined;
            }
            this.disposeFileWatchers();
            this.routeCache.clear();
            this.mappingCache.clear();
            this.parser.clearCache();
            this.moduleMappings.clear();
            this.visitedDirs.clear();
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
