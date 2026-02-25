// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { RouteAnalyzer } from './helper/routeAnalyzer';
import { showModuleTag } from './utils/createLabel';
import { alert } from './utils/alert';
import { Logger } from './utils/logger';

class ExtensionManager {
	private routeAnalyzer: RouteAnalyzer;
	private statusBarItems: vscode.StatusBarItem | undefined;
	private disposables: vscode.Disposable[] = [];
	private logger: Logger;
	private context: vscode.ExtensionContext;
	private isInitialized: boolean = false;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.logger = Logger.getInstance();
		this.routeAnalyzer = new RouteAnalyzer(context);
	}

	public async initialize(): Promise<void> {
		try {
			this.logger.info('Extension initializing...');

			// 注册文件分析完成后的回调（文件监听触发重新分析时自动刷新状态栏）
			this.routeAnalyzer.setOnAnalysisCompleteCallback(() => {
				this.handleActiveEditor(vscode.window.activeTextEditor);
			});

			// 初始化路由分析器
			await this.routeAnalyzer.initialize();

			// 注册事件监听器
			this.registerEventListeners();

			// 注册命令
			this.registerCommands();

			// 处理当前活动编辑器
			this.handleActiveEditor(vscode.window.activeTextEditor);

			this.isInitialized = true;
			this.logger.info('Extension initialized successfully');

		} catch (error) {
			this.logger.error('Failed to initialize extension', error as Error);
			vscode.window.showErrorMessage(`Failed to initialize route analyzer: ${(error as Error).message}`);
		}
	}

	private registerEventListeners(): void {
		// 监听活动编辑器变化
		const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
			this.handleActiveEditor(editor);
		});

		// 监听配置变化
		const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('extensionmodulemap')) {
				this.logger.info('Configuration changed, reinitializing...');
				this.reinitialize();
			}
		});

		this.context.subscriptions.push(editorChangeDisposable, configChangeDisposable);
	}

	private registerCommands(): void {
		const restartCommand = vscode.commands.registerCommand('extensionmodulemap.restartModuleMap', async () => {
			await this.handleRestartCommand();
		});

		this.context.subscriptions.push(restartCommand);
	}

	private async handleRestartCommand(): Promise<void> {
		try {
			this.logger.info('Manual restart requested');

			if (!await this.routeAnalyzer.checkRouteFileExists()) {
				alert();
				return;
			}

			await this.reinitialize();
			vscode.window.showInformationMessage('Module mapping reanalyzed successfully');

		} catch (error) {
			this.logger.error('Failed to restart module mapping', error as Error);
			vscode.window.showErrorMessage('Failed to restart module mapping');
		}
	}

	private async reinitialize(): Promise<void> {
		// 清理现有资源
		this.cleanup();

		// 重新初始化
		await this.routeAnalyzer.initialize();

		// 重新处理当前编辑器
		this.handleActiveEditor(vscode.window.activeTextEditor);
	}

	private handleActiveEditor(editor: vscode.TextEditor | undefined): void {
		// 清理之前的状态栏项
		this.cleanup();

		if (!editor || !this.isInitialized) {
			return;
		}

		const filePath = editor.document.uri.fsPath;

		console.log('this.routeAnalyzer 119', filePath);
		const moduleInfo = this.routeAnalyzer.getModuleForFile(filePath);
		console.log('moduleInfo 119', moduleInfo);

		if (moduleInfo) {
			try {
				const result = showModuleTag(moduleInfo);
				this.statusBarItems = result.statusBarItem;
				this.disposables.push(...result.disposables);

				this.logger.debug('Module info displayed for file', { filePath, moduleName: moduleInfo.moduleNames });
			} catch (error) {
				this.logger.error('Failed to show module tag', error as Error);
			}
		}
	}

	private cleanup(): void {
		if (this.statusBarItems) {
			this.statusBarItems.dispose();
			this.statusBarItems = undefined;
		}

		this.disposables.forEach(disposable => {
			try {
				disposable.dispose();
			} catch (error) {
				this.logger.warn('Failed to dispose resource', error as Error);
			}
		});
		this.disposables = [];
	}

	public dispose(): void {
		this.logger.info('Extension disposing...');
		this.cleanup();

		// 清理缓存
		if (this.routeAnalyzer) {
			this.routeAnalyzer.cleanupCache();
		}
	}
}

let extensionManager: ExtensionManager;

export function activate(context: vscode.ExtensionContext) {
	extensionManager = new ExtensionManager(context);
	extensionManager.initialize();
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (extensionManager) {
		extensionManager.dispose();
	}
}
