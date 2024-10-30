// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { RouteAnalyzer } from './controller/routeAnalyzer';
import { showModuleTag } from './utils/createLabel';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const routeAnalyzer = new RouteAnalyzer(context);



	const disposable = vscode.commands.registerCommand('extensionmodulemap.seeModuleMapName', () => {

		// vscode.window.showInformationMessage(`routeAnalyzer 初始化完成, ${routeAnalyzer}`);
		// const globalWindow = vscode.window;
		// const editor = vscode.window.activeTextEditor;

		// if (!editor) {
		// 	globalWindow.showInformationMessage('请打开一个文件');
		// 	return;
		// }

		// const document = editor.document;

		// globalWindow.showInformationMessage('请选择要格式化的代码');
		// const txt = document.getText(editor.selection).replace(/\s+console.(log|error|warn|info|debug)\((.*)\);/g, '');
		// editor.edit(edit => {
		// 	edit.replace(editor.selection, txt);
		// });
		// globalWindow.showInformationMessage('格式化完成ddddaaaaa asdasdasd');

		// 初始化分析器;
		routeAnalyzer.initialize().then(() => {
			// 注册文件打开事件监听
			context.subscriptions.push(
				vscode.window.onDidChangeActiveTextEditor(editor => {
					if (editor) {
						const filePath = editor.document.uri.fsPath;
						const moduleInfo = routeAnalyzer.getModuleForFile(filePath);

						if (moduleInfo) {
							// 显示模块标签
							showModuleTag(editor, moduleInfo.moduleName);
						}
					}
				})
			);
		}).catch(error => {
			vscode.window.showErrorMessage(`Failed to initialize route analyzer: ${error.message}`);
		});
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }
