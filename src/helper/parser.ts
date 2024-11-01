// import * as vscode from 'vscode';
// import * as fs from 'fs';
// import * as path from 'path';
// import * as parser from '@babel/parser';
// import * as traverse from '@babel/traverse';

// // 存储模块依赖关系的类
// class DependencyGraph {
//     private dependencies: Map<string, Set<string>>;

//     constructor() {
//         this.dependencies = new Map();
//     }

//     addDependency(from: string, to: string) {
//         if (!this.dependencies.has(from)) {
//             this.dependencies.set(from, new Set());
//         }
//         this.dependencies.get(from)!.add(to);
//     }

//     getDependencies(): Map<string, Set<string>> {
//         return this.dependencies;
//     }
// }

// // 分析文件依赖的主要类
// export class DependencyAnalyzer {
//     private graph: DependencyGraph;
//     private readonly extensions = ['.js', '.jsx', '.ts', '.tsx'];

//     constructor() {
//         this.graph = new DependencyGraph();
//     }

//     // 分析指定目录
//     async analyzeDependencies(dirPath: string) {
//         try {
//             await this.processDirectory(dirPath);
//             return this.graph.getDependencies();
//         } catch (error) {
//             console.error('Error analyzing dependencies:', error);
//             throw error;
//         }
//     }

//     // 处理目录
//     private async processDirectory(dirPath: string) {
//         const files = await fs.promises.readdir(dirPath);

//         for (const file of files) {
//             const filePath = path.join(dirPath, file);
//             const stat = await fs.promises.stat(filePath);

//             if (stat.isDirectory()) {
//                 await this.processDirectory(filePath);
//             } else if (this.isValidFile(filePath)) {
//                 await this.analyzeFile(filePath);
//             }
//         }
//     }

//     // 检查文件是否为支持的类型
//     private isValidFile(filePath: string): boolean {
//         return this.extensions.includes(path.extname(filePath));
//     }

//     // 分析单个文件
//     private async analyzeFile(filePath: string) {
//         try {
//             const content = await fs.promises.readFile(filePath, 'utf-8');
//             const ast = parser.parse(content, {
//                 sourceType: 'module',
//                 plugins: ['jsx', 'typescript'],
//             });

//             traverse(ast, {
//                 ImportDeclaration: (path: { node: { source: { value: any; }; }; }) => {
//                     const importPath = path.node.source.value;
//                     if (!importPath.startsWith('.')) { return; } // 只处理相对路径导入

//                     const resolvedPath = this.resolveImportPath(filePath, importPath);
//                     if (resolvedPath) {
//                         this.graph.addDependency(filePath, resolvedPath);
//                     }
//                 },
//                 CallExpression: (path: { node: { callee: { type: string; name: string; }; arguments: any; }; }) => {
//                     if (path.node.callee.type === 'Identifier' &&
//                         path.node.callee.name === 'require') {
//                         const args = path.node.arguments;
//                         if (args.length && args[0].type === 'StringLiteral') {
//                             const importPath = args[0].value;
//                             if (!importPath.startsWith('.')) { return; }

//                             const resolvedPath = this.resolveImportPath(filePath, importPath);
//                             if (resolvedPath) {
//                                 this.graph.addDependency(filePath, resolvedPath);
//                             }
//                         }
//                     }
//                 }
//             });
//         } catch (error) {
//             console.error(`Error analyzing file ${filePath}:`, error);
//         }
//     }

//     // 解析导入路径
//     private resolveImportPath(currentFile: string, importPath: string): string | null {
//         const directory = path.dirname(currentFile);
//         let resolvedPath = path.resolve(directory, importPath);

//         // 检查是否需要添加扩展名
//         if (!path.extname(resolvedPath)) {
//             for (const ext of this.extensions) {
//                 const pathWithExt = resolvedPath + ext;
//                 if (fs.existsSync(pathWithExt)) {
//                     return pathWithExt;
//                 }
//             }
//             // 检查 index 文件
//             for (const ext of this.extensions) {
//                 const indexPath = path.join(resolvedPath, `index${ext}`);
//                 if (fs.existsSync(indexPath)) {
//                     return indexPath;
//                 }
//             }
//             return null;
//         }

//         return fs.existsSync(resolvedPath) ? resolvedPath : null;
//     }
// }

// // VSCode 命令注册
// // export function activate(context: vscode.ExtensionContext) {
// //     let disposable = vscode.commands.registerCommand('extension.analyzeDependencies', async () => {
// //         const workspaceFolders = vscode.workspace.workspaceFolders;
// //         if (!workspaceFolders) {
// //             vscode.window.showErrorMessage('请打开一个工作区文件夹');
// //             return;
// //         }

// //         const analyzer = new DependencyAnalyzer();
// //         try {
// //             const dependencies = await analyzer.analyzeDependencies(workspaceFolders[0].uri.fsPath);

// //             // 创建依赖关系的可视化输出
// //             let output = '模块依赖关系分析结果：\n\n';
// //             dependencies.forEach((deps, file) => {
// //                 const relativePath = path.relative(workspaceFolders[0].uri.fsPath, file);
// //                 output += `${relativePath}:\n`;
// //                 deps.forEach(dep => {
// //                     const relativeDepPath = path.relative(workspaceFolders[0].uri.fsPath, dep);
// //                     output += `  - ${relativeDepPath}\n`;
// //                 });
// //                 output += '\n';
// //             });

// //             // 显示结果
// //             const outputChannel = vscode.window.createOutputChannel('依赖分析');
// //             outputChannel.clear();
// //             outputChannel.append(output);
// //             outputChannel.show();
// //         } catch (error) {
// //             vscode.window.showErrorMessage('分析依赖关系时出错');
// //         }
// //     });

// //     context.subscriptions.push(disposable);
// // }