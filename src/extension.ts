// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { RouteAnalyzer } from './helper/routeAnalyzer';
import { showModuleTag } from './utils/createLabel';

export function activate(context: vscode.ExtensionContext) {
	const routeAnalyzer = new RouteAnalyzer(context);

	function start() {
		// 初始化分析器;
		routeAnalyzer.initialize().then(() => {

			console.log('routeAnalyzer 初始化完成');
			// 注册文件打开事件监听
			context.subscriptions.push(
				vscode.window.onDidChangeActiveTextEditor(editor => {
					if (editor) {
						const filePath = editor.document.uri.fsPath;
						const moduleInfo = routeAnalyzer.getModuleForFile(filePath);
						if (moduleInfo) {
							// 显示模块标签
							showModuleTag(editor, moduleInfo);
						}
					}
				})
			);
		}).catch(error => {
			vscode.window.showErrorMessage(`Failed to initialize route analyzer: ${error.message}`);
		});
	}

	// 监听文件打开事件, 以防插件初始化失败，在文件打开后重新初始化
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
		const initStatus = routeAnalyzer.getInitStatus();
		console.log('initStatus', initStatus);
		if (!initStatus) {
			start();
		}
	}));

	// 默认打开项目时初始化模块映射分析
	start();
	// 通过菜单重启模块映射分析
	const disposable = vscode.commands.registerCommand('extensionmodulemap.restartModuleMap', () => {
		start();
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }
