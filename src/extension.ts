// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { RouteAnalyzer } from './helper/routeAnalyzer';
import { showModuleTag } from './utils/createLabel';

export function activate(context: vscode.ExtensionContext) {
	const routeAnalyzer = new RouteAnalyzer(context);

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

	const disposable = vscode.commands.registerCommand('extensionmodulemap.seeModuleMapName', () => {
		vscode.window.showInformationMessage('你好👋');
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }
