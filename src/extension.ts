import * as vscode from 'vscode';
import { RouteAnalyzer } from './helper/routeAnalyzer';
import { showModuleTag } from './utils/createLabel';
import { Logger } from './utils/logger';

class ExtensionManager {
	/**
	 * 每个工作区文件夹对应一个独立的 RouteAnalyzer 实例
	 * key: WorkspaceFolder.uri.fsPath（文件夹的绝对路径）
	 */
	private routeAnalyzers: Map<string, RouteAnalyzer> = new Map();
	private statusBarItems: vscode.StatusBarItem | undefined;
	private disposables: vscode.Disposable[] = [];
	private logger: Logger;
	private context: vscode.ExtensionContext;
	private isInitialized: boolean = false;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.logger = Logger.getInstance();
	}

	public async initialize(): Promise<void> {
		try {
			this.logger.info('Extension initializing...');

			const folders = vscode.workspace.workspaceFolders ?? [];

			if (folders.length === 0) {
				this.logger.warn('No workspace folders found, extension will remain idle');
			} else {
				// 为每个工作区文件夹并行初始化分析器（某个文件夹失败不影响其他的）
				await Promise.allSettled(
					folders.map(folder => this.initializeAnalyzerForFolder(folder))
				);
			}

			this.registerEventListeners();
			this.registerCommands();
			this.handleActiveEditor(vscode.window.activeTextEditor);

			this.isInitialized = true;
			this.logger.info('Extension initialized', {
				totalFolders: folders.length,
				activeAnalyzers: this.routeAnalyzers.size
			});
		} catch (error) {
			this.logger.error('Failed to initialize extension', error as Error);
			vscode.window.showErrorMessage(`Failed to initialize route analyzer: ${(error as Error).message}`);
		}
	}

	/**
	 * 为单个工作区文件夹创建并初始化路由分析器
	 * 若该文件夹内不存在路由配置文件则静默跳过（不报错）
	 */
	private async initializeAnalyzerForFolder(folder: vscode.WorkspaceFolder): Promise<void> {
		try {
			const analyzer = new RouteAnalyzer(this.context, folder.uri.fsPath, folder.uri);

			if (!await analyzer.checkRouteFileExists()) {
				this.logger.info(`No route config in folder "${folder.name}", skipping`);
				return;
			}

			// 文件监听触发重新分析完成后，刷新当前活动编辑器的状态栏
			analyzer.setOnAnalysisCompleteCallback(() => {
				this.handleActiveEditor(vscode.window.activeTextEditor);
			});

			await analyzer.initialize();
			this.routeAnalyzers.set(folder.uri.fsPath, analyzer);

			this.logger.info(`Analyzer ready for folder "${folder.name}"`, {
				folderPath: folder.uri.fsPath
			});
		} catch (error) {
			this.logger.error(`Failed to initialize analyzer for folder "${folder.name}"`, error as Error);
		}
	}

	private registerEventListeners(): void {
		// 切换活动编辑器时更新状态栏
		const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
			this.handleActiveEditor(editor);
		});

		// 插件配置变更：用 folder scope 精准判断，只重启受影响的文件夹
		const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(event => {
			if (!event.affectsConfiguration('extensionmodulemap')) { return; }

			const folders = vscode.workspace.workspaceFolders ?? [];
			for (const folder of folders) {
				// affectsConfiguration 支持 folder.uri 作用域：
				// 全局配置变更时所有文件夹均返回 true；
				// 仅修改某个文件夹的 .vscode/settings.json 时只有该文件夹返回 true
				if (event.affectsConfiguration('extensionmodulemap', folder.uri)) {
					this.logger.info(`Config changed for folder "${folder.name}", reinitializing...`);
					this.reinitializeFolder(folder);
				}
			}
		});

		// 多根工作区：监听文件夹的动态添加 / 移除
		const folderChangeDisposable = vscode.workspace.onDidChangeWorkspaceFolders(async event => {
			// 移除已删除文件夹对应的分析器
			for (const removed of event.removed) {
				const analyzer = this.routeAnalyzers.get(removed.uri.fsPath);
				if (analyzer) {
					analyzer.dispose();
					this.routeAnalyzers.delete(removed.uri.fsPath);
					this.logger.info(`Analyzer removed for folder "${removed.name}"`);
				}
			}

			// 为新增文件夹初始化分析器
			for (const added of event.added) {
				await this.initializeAnalyzerForFolder(added);
				this.logger.info(`Analyzer added for folder "${added.name}"`);
			}

			this.handleActiveEditor(vscode.window.activeTextEditor);
		});

		this.context.subscriptions.push(
			editorChangeDisposable,
			configChangeDisposable,
			folderChangeDisposable
		);
	}

	private registerCommands(): void {
		const restartCommand = vscode.commands.registerCommand(
			'extensionmodulemap.restartModuleMap',
			async () => { await this.handleRestartCommand(); }
		);
		this.context.subscriptions.push(restartCommand);
	}

	private async handleRestartCommand(): Promise<void> {
		try {
			this.logger.info('Manual restart requested');

			// 优先只重启当前活动文件所在项目，避免不必要地影响其他项目
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor) {
				const folder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
				if (folder) {
					await this.reinitializeFolder(folder);
					vscode.window.showInformationMessage(`"${folder.name}" 模块映射已重新分析`);
					return;
				}
			}

			// 没有活动文件或文件不属于任何工作区文件夹时，全量重启
			await this.reinitialize();
			vscode.window.showInformationMessage(
				`所有项目模块映射已重新分析 (${this.routeAnalyzers.size} 个项目)`
			);
		} catch (error) {
			this.logger.error('Failed to restart module mapping', error as Error);
			vscode.window.showErrorMessage('Failed to restart module mapping');
		}
	}

	/**
	 * 只重新初始化指定工作区文件夹的 Analyzer，不影响其他文件夹
	 * 只有当活动文件恰好属于该文件夹时才刷新状态栏，避免无谓的 UI 更新
	 */
	private async reinitializeFolder(folder: vscode.WorkspaceFolder): Promise<void> {
		try {
			// 销毁该文件夹现有的分析器（如有）
			const existing = this.routeAnalyzers.get(folder.uri.fsPath);
			if (existing) {
				existing.dispose();
				this.routeAnalyzers.delete(folder.uri.fsPath);
			}

			// 重新初始化该文件夹
			await this.initializeAnalyzerForFolder(folder);

			// 仅当活动文件属于本文件夹时刷新状态栏
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor) {
				const activeFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
				if (activeFolder?.uri.fsPath === folder.uri.fsPath) {
					this.handleActiveEditor(activeEditor);
				}
			}
		} catch (error) {
			this.logger.error(`Failed to reinitialize folder "${folder.name}"`, error as Error);
		}
	}

	/**
	 * 全量重新初始化所有工作区文件夹（用于无法确定受影响范围的场景）
	 */
	private async reinitialize(): Promise<void> {
		this.cleanup();

		for (const [, analyzer] of this.routeAnalyzers) {
			analyzer.dispose();
		}
		this.routeAnalyzers.clear();

		const folders = vscode.workspace.workspaceFolders ?? [];
		await Promise.allSettled(
			folders.map(folder => this.initializeAnalyzerForFolder(folder))
		);

		this.handleActiveEditor(vscode.window.activeTextEditor);
	}

	/**
	 * 根据当前活动编辑器的文件，找到所属工作区文件夹对应的分析器，更新右下角状态栏
	 */
	private handleActiveEditor(editor: vscode.TextEditor | undefined): void {
		this.cleanup();

		if (!editor || !this.isInitialized) {
			return;
		}

		const fileUri = editor.document.uri;
		this.logger.debug('handleActiveEditor fileUri', fileUri);

		// 找到该文件所属的工作区文件夹
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
		if (!workspaceFolder) {
			return; // 文件不属于任何工作区文件夹（如临时文件、系统文件等）
		}

		this.logger.debug('handleActiveEditor workspaceFolder', workspaceFolder);

		const analyzer = this.routeAnalyzers.get(workspaceFolder.uri.fsPath);
		if (!analyzer || !analyzer.getInitStatus()) {
			return; // 该文件夹没有对应的分析器（可能没有路由配置文件）
		}

		this.logger.debug('handleActiveEditor analyzer', analyzer);

		const moduleInfo = analyzer.getModuleForFile(fileUri.fsPath);

		this.logger.debug('handleActiveEditor moduleInfo', moduleInfo);

		if (moduleInfo) {
			try {
				const result = showModuleTag(moduleInfo);
				this.statusBarItems = result.statusBarItem;
				this.disposables.push(...result.disposables);

				this.logger.debug('Module info displayed', {
					file: fileUri.fsPath,
					folder: workspaceFolder.name,
					module: moduleInfo.moduleNames
				});
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

		for (const [, analyzer] of this.routeAnalyzers) {
			analyzer.cleanupCache();
		}
	}
}

let extensionManager: ExtensionManager;

export function activate(context: vscode.ExtensionContext) {
	extensionManager = new ExtensionManager(context);
	extensionManager.initialize();
}

export function deactivate() {
	if (extensionManager) {
		extensionManager.dispose();
	}
}
