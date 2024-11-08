import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
// import { Parser } from './parser';

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
    hideInMenu?: boolean;
    filePath: string;
    isDep?: boolean;
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
    // private parser: Parser;

    constructor(context: vscode.ExtensionContext) {
        this.moduleMappings = new Map();
        this.rootModuleFileTags = new Map();
        this.iteratorDirArray = new WeakMap();
        this.routes = [];
        this.relevantExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.json', '.d.ts', '.less', '.scss', '.css'];


        // this.parser = new Parser(context);

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
            // 检查路由文件是否存在
            if (!await this.checkRouteFileExists()) {
                this.initStatus = false;
                return;
            }
            this.moduleMappings.clear();
            // 分析路由文件
            await this.analyzeRoutes();
            this.initStatus = true;
            // 注册文件监听
            this.watchFileChanges();
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
            // 初始化json配置文件
            // await this.parser.initBeforeParseConfig();
            // 读取路由文件
            const content = await fs.readFile(this.routeFilePath, 'utf-8');
            // 解析路由配置，扁平化处理
            await this.deepParseRouteConfig(content);
            // 建立模块映射
            await this.buildModuleMappings();
        } catch (error) {
            console.error('Failed to analyze routes:', error);
            throw error;
        }
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
            this.routes = await this.parseAndFlattenRoutes(exportMatch[1]);
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
    private async buildModuleMappings() {
        for await (const route of this.routes) {
            if (route.component) {
                const moduleDirName = this.extractModuleName(route.component);
                const componentPath = this.resolveComponentPath(moduleDirName);
                // 映射模块文件
                await this.mapModuleFiles(componentPath, route.name!, route.path!, route.component, true);
            }
        }
    }

    /**
     * @description 映射模块下的所有相关文件(递归)
     * @param dir 路由组件目录，例如 xxx/user, user是个目录
     * @param moduleName 当前路由模块名称，例如name: 登录
     * @param routePath 当前路由的页面路由路径
     * @param componentPath 当前路由组件路径
     * @param isRoot 是否为pages下的根文件
     */
    private async mapModuleFiles(dir: string, moduleName: string, routePath: string, componentPath: string, isRoot: boolean) {
        try {
            // 首先检查目录是否存在
            const dirExists = await fs.access(dir).then(() => true).catch(() => false);
            if (!dirExists) {
                return;
            }
            // 首次读取目录下的所有文件
            const files = await fs.readdir(dir, { withFileTypes: true });
            // 检查目录名是否与模块名匹配
            for (const file of files) {
                // 完整文件路径xxx/xxx/xxx/xxx(.ts|.tsx|.js|.jsx|.vue|.json|.d.ts|.less|.scss|.css)或者目录名称
                const filePath = path.join(dir, file.name);
                let mapping: ModuleMapping;
                const isInTurelyStuck = this.isRelevantFile(file.name) && !this.moduleMappings.has(filePath);

                if (file.isDirectory() && !this.iteratorDirArray.get(this)?.includes(filePath)) {
                    this.iteratorDirArray.set(this, [...this.iteratorDirArray.get(this) || [], filePath]);
                    // moduleName 会受routes的遍历初始值影响，
                    // 因此如果首个同名文件夹下的其余其他文件夹内的文件，都会受该值moduleName影响
                    // 后生代目录递归查找文件
                    await this.mapModuleFiles(filePath, moduleName, routePath, componentPath, false);
                } else if (isInTurelyStuck && isRoot) {
                    // 查找文件根目录index及相关文件，对比路由配置信息
                    const moduleInfo = this.parseFindModule(filePath);
                    // 存储路由跟目录下匹配的路由名称，提供给目录下的非路由文件作tags提示
                    const moduleNames = [...new Set([...(this.rootModuleFileTags.get(dir) || []), moduleInfo?.name || moduleName || ''])].filter(Boolean) as string[];
                    this.rootModuleFileTags.set(dir, moduleNames);
                    mapping = {
                        moduleNames: moduleInfo?.name ? [moduleInfo.name!] : moduleNames, // 兼容一些乱序的路由文件信息
                        routePath: moduleInfo?.path || routePath,
                        hideInMenu: moduleInfo?.hideInMenu || false,
                        filePath
                    };
                    // 通过ast解析pages目录组件依赖，待定方案
                    // const importInfo = await this.parser.analyze(filePath);
                    // console.log('importInfo', importInfo);
                    this.moduleMappings.set(filePath, mapping);
                } else if (isInTurelyStuck && !isRoot) {
                    const timer = setTimeout(async () => {
                        // 获取深层子目录的上级目录 ./xx/xx.ts => ./xx, ./xxx/xxx/xxx.ts => ./xxx/xxx
                        const parentDir = path.dirname(dir);
                        // 从存储的当前文件父级目录中获取目录下的所存储的路由名称tags(有可能为空，上级扫描时，祖先目录不存在路由映射文件)
                        // 相对于上级目录的再上级，一般为pages/xxxx,更深层次的则取上一级pages/xxxx/xxxx, todo: 存在不同目录同tags的情况，可优化
                        let moduleNames = this.rootModuleFileTags.get(parentDir) || [];
                        let moduleInfo: RouteConfig | undefined;

                        // 处理深层文件索引最外层目录菜单名称
                        // 如果不存在，则重新下一步检查路由信息，重新回走前置检查
                        const noHaveModuleNames = moduleNames?.length === 0;
                        if (noHaveModuleNames) {
                            // 过滤旧tag
                            // tags为空时，则直接找pages下的祖先目录，获取tags（也有可能为空，祖先目录不存在文件时）
                            // 重新查找深度复杂目录路由文件
                            moduleInfo = this.parseFindModule(filePath);
                            moduleNames = [...new Set([...(this.rootModuleFileTags.get(dir) || []), moduleInfo?.name || moduleName || ''])].filter(Boolean) as string[];

                            this.rootModuleFileTags.set(dir, moduleNames);
                        }
                        // 特殊目录路由
                        if (filePath.includes(`${path.sep}user${path.sep}login`)) {
                            moduleNames = ['login'];
                        }
                        // 非根目录下的文件
                        mapping = {
                            moduleNames: moduleInfo?.name ? [moduleInfo?.name] : moduleNames ?? [],
                            routePath: moduleInfo?.path || routePath,
                            hideInMenu: moduleInfo?.hideInMenu || false,
                            filePath,
                        };
                        // 如上
                        // const importInfo = await this.parser.analyze(filePath);
                        // console.log('importInfo 372', importInfo);
                        this.moduleMappings.set(filePath, mapping);

                        clearTimeout(timer);
                    }, 100);
                }
            }
        } catch (error) {
            console.error(`Failed to map files in directory ${dir}:`, error);
        }
    }


    /**
     * 
     * @param filePath 文件全路径，例如 xxx/xxx/xx.xx
     * @returns 查找到的路由模块，如果没有返回undefined
     */
    private parseFindModule(filePath: string,) {
        const suffix = path.extname(filePath);
        // 获取文件路径
        const componentSourcePath = filePath.split(suffix)[0];
        const moduleInfo = this.routes.find((route) => {
            let r_component = route.component;
            // 处理组件路径为./Work 该路径下的路由, 默认优先匹配index
            if (r_component && r_component.split(path.sep).length <= 2) {
                // 等同于 src/pages/Work
                // todo: 判断是否存在index根文件，有隐患，因为开发有可能会起.css/.js/.scss等文件
                r_component = path.resolve(this.targetModulePath, r_component!);
                return `${r_component}${path.sep}index` === componentSourcePath;
            }
            // 匹配index
            if (/^(.*)\/index\.(ts|tsx|jsx)$/g.test(filePath)) {
                r_component = path.resolve(this.targetModulePath, `${r_component}${path.sep}${path.basename(filePath).replace(suffix, '')}`);
                return r_component === componentSourcePath;
            }

            // 路径大于(./Work/detail)长度的则直接匹配搜索
            r_component = path.resolve(this.targetModulePath, r_component!);
            return r_component === componentSourcePath;
        });

        return moduleInfo;
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
     * 监听文件变化
     */
    private watchFileChanges(): void {
        // 监听路由文件变化
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, `**${path.sep}routes${path.sep}**${path.sep}*`)
        );

        // 监听模块文件变化
        const watcher2 = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, `**${path.sep}src${path.sep}pages${path.sep}**${path.sep}*`)
        );

        // 监听json配置文件变化
        // const watcher3 = vscode.workspace.createFileSystemWatcher(
        //     new vscode.RelativePattern(this.workspaceRoot, `**${path.sep}{jsconfig,tsconfig}.json`)
        // );

        watcher.onDidChange(() => this.analyzeRoutes());
        watcher.onDidCreate(() => this.analyzeRoutes());
        watcher.onDidDelete(() => this.analyzeRoutes());

        watcher2.onDidChange(() => this.analyzeRoutes());
        watcher2.onDidCreate(() => this.analyzeRoutes());
        watcher2.onDidDelete(() => this.analyzeRoutes());

        // watcher3.onDidChange(() => this.parser.initBeforeParseConfig());
        // watcher3.onDidCreate(() => this.parser.initBeforeParseConfig());
        // watcher3.onDidDelete(() => this.parser.initBeforeParseConfig());
    }

    /**
     * 获取文件对应的模块信息
     */
    public getModuleForFile(filePath: string): ModuleMapping | undefined {
        return this.moduleMappings.get(filePath);
    }
}