// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { RouteAnalyzer } from './helper/routeAnalyzer';
import { showModuleTag } from './utils/createLabel';

let disposables: vscode.Disposable[] = [];
export function activate(context: vscode.ExtensionContext) {
	const routeAnalyzer = new RouteAnalyzer(context);

	let statusBarItems: vscode.StatusBarItem;

	function start() {
		// 初始化分析器;
		routeAnalyzer.initialize().then(() => {

			console.log('routeAnalyzer 初始化完成');
			// 注册文件打开事件监听
			context.subscriptions.push(
				vscode.window.onDidChangeActiveTextEditor(editor => {
					if (statusBarItems) {
						statusBarItems.dispose();
						disposables.forEach(disposable => disposable.dispose());
					}
					if (editor) {
						const filePath = editor.document.uri.fsPath;
						const moduleInfo = routeAnalyzer.getModuleForFile(filePath);
						if (moduleInfo) {
							// 显示模块标签-右下角
							const result = showModuleTag(editor, moduleInfo);
							statusBarItems = result.statusBarItem;
							disposables.push(...result.disposables);
						}
					}
				})
			);
		}).catch(error => {
			vscode.window.showErrorMessage(`Failed to initialize route analyzer: ${error.message}`);
		});
	}

	// 默认打开项目时初始化模块映射分析
	start();
	// 通过菜单重启模块映射分析
	const disposable = vscode.commands.registerCommand('extensionmodulemap.restartModuleMap', () => {
		start();
	});

	context.subscriptions.push(disposable);
}

// This method is call	ed when your extension is deactivated
export function deactivate() {
	// 销毁所有info disposables
	disposables.forEach(disposable => disposable.dispose());
}
