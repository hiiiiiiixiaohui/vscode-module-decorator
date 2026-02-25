import * as vscode from 'vscode';

/**
 * 将绝对路径转换为相对于 src/ 的展示路径（兼容 Windows / macOS）
 */
function toRelativePath(absPath: string): string {
    const normalized = absPath.replace(/\\/g, '/');
    const srcIndex = normalized.indexOf('/src/');
    if (srcIndex !== -1) {
        return normalized.slice(srcIndex + 1);
    }
    return normalized;
}

/**
 * 将同模块文件列表格式化为 tooltip 中的 markdown 列表
 * 为保持可读性，最多展示 maxShow 条，超出时显示剩余数量
 */
function formatFileList(files: string[], maxShow = 8): string {
    if (files.length === 0) return '';
    // const shown = files.slice(0, maxShow);
    // const rest = files.length - shown.length;
    const lines = files.map(f => `  - \`${toRelativePath(f)}\``).join('\n');
    return lines;
    // return rest > 0 ? `${lines}\n  - *...还有 ${rest} 个文件*` : lines;
}

// 显示模块标签的函数
export function showModuleTag(moduleInfo: Record<string, any>) {
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );

    const moduleName = Array.isArray(moduleInfo.moduleNames) && moduleInfo.moduleNames.length > 1
        ? moduleInfo.moduleNames.filter(Boolean).join(' / ')
        : moduleInfo.moduleNames.filter(Boolean)[0] ?? 'Not Found';
    const hideInMenu = moduleInfo?.hideInMenu ?? false;
    const formattedModuleName = moduleName?.replace('·', '');

    statusBarItem.text = `$(tag) ${formattedModuleName}`;

    const tooltipContent = new vscode.MarkdownString();
    tooltipContent.isTrusted = true;
    tooltipContent.supportHtml = true;

    // ── 路由信息 ──────────────────────────────────────────────────
    tooltipContent.appendMarkdown(`### 模块信息\n\n`);
    tooltipContent.appendMarkdown(`- **模块名称**: ${formattedModuleName} [复制](command:extensionmodulemap.copyModuleName)\n`);
    tooltipContent.appendMarkdown(`- **Title**: ${moduleInfo?.title || '—'} [复制](command:extensionmodulemap.copyRouteTitle)\n`);
    tooltipContent.appendMarkdown(`- **Access**: \`${moduleInfo?.access || '—'}\`\n`);
    tooltipContent.appendMarkdown(`- **HideInMenu**: ${String(hideInMenu).charAt(0).toUpperCase() + String(hideInMenu).slice(1)} [复制](command:extensionmodulemap.copyHideInMenu)\n`);
    tooltipContent.appendMarkdown(`- **页面路由**: \`${moduleInfo.routePath}\` [复制](command:extensionmodulemap.copyRoutePath)\n`);
    tooltipContent.appendMarkdown(`- **文件路径**: \`${toRelativePath(moduleInfo.filePath)}\` [复制](command:extensionmodulemap.copyFilePath)\n`);

    // ── 文件依赖关系 ──────────────────────────────────────────────
    const dependencies: string[] = moduleInfo.dependencies || [];
    const dependents: string[] = moduleInfo.dependents || [];

    if (dependencies.length > 0 || dependents.length > 0) {
        tooltipContent.appendMarkdown(`\n---\n\n`);
        tooltipContent.appendMarkdown(`### 文件依赖关系\n\n`);

        if (dependencies.length > 0) {
            tooltipContent.appendMarkdown(`**依赖文件** *(本文件 import 了以下模块内文件，共 ${dependencies.length} 个)*\n\n`);
            tooltipContent.appendMarkdown(`${formatFileList(dependencies)}\n\n`);
        } else {
            tooltipContent.appendMarkdown(`**依赖文件**: 无模块内部依赖\n\n`);
        }

        if (dependents.length > 0) {
            tooltipContent.appendMarkdown(`**被依赖文件** *(以下模块内文件 import 了本文件，共 ${dependents.length} 个)*\n\n`);
            tooltipContent.appendMarkdown(`${formatFileList(dependents)}\n\n`);
        } else {
            tooltipContent.appendMarkdown(`**被依赖文件**: 暂无模块内文件引用本文件\n`);
        }
    }

    tooltipContent.appendMarkdown(`\n---\n\n[复制全部信息](command:extensionmodulemap.copyAllInfo)`);

    statusBarItem.tooltip = tooltipContent;

    // 注册复制命令
    const disposables = [
        vscode.commands.registerCommand('extensionmodulemap.copyModuleName', () => {
            vscode.env.clipboard.writeText(formattedModuleName).then(() => {
                vscode.window.showInformationMessage('模块名称已复制');
            });
        }),
        vscode.commands.registerCommand('extensionmodulemap.copyRouteTitle', () => {
            vscode.env.clipboard.writeText(moduleInfo.title || '').then(() => {
                vscode.window.showInformationMessage('模块Title已复制');
            });
        }),
        vscode.commands.registerCommand('extensionmodulemap.copyHideInMenu', () => {
            vscode.env.clipboard.writeText(`${hideInMenu}`).then(() => {
                vscode.window.showInformationMessage('是否隐藏已复制');
            });
        }),
        vscode.commands.registerCommand('extensionmodulemap.copyRoutePath', () => {
            vscode.env.clipboard.writeText(moduleInfo.routePath).then(() => {
                vscode.window.showInformationMessage('页面路由已复制');
            });
        }),
        vscode.commands.registerCommand('extensionmodulemap.copyFilePath', () => {
            vscode.env.clipboard.writeText(toRelativePath(moduleInfo.filePath)).then(() => {
                vscode.window.showInformationMessage('文件路径已复制');
            });
        }),
        vscode.commands.registerCommand('extensionmodulemap.copyAllInfo', () => {
            const depList = (moduleInfo.dependencies || []).map((f: string) => `    - ${toRelativePath(f)}`).join('\n');
            const depentList = (moduleInfo.dependents || []).map((f: string) => `    - ${toRelativePath(f)}`).join('\n');
            const moduleText = [
                `模块名称: ${formattedModuleName}`,
                `Title: ${moduleInfo.title || '—'}`,
                `Access: ${moduleInfo.access || '—'}`,
                `HideInMenu: ${hideInMenu}`,
                `页面路由: ${moduleInfo.routePath}`,
                `文件路径: ${toRelativePath(moduleInfo.filePath)}`,
                depList ? `依赖文件:\n${depList}` : '依赖文件: 无',
                depentList ? `被依赖文件:\n${depentList}` : '被依赖文件: 无',
            ].join('\n');
            vscode.env.clipboard.writeText(moduleText).then(() => {
                vscode.window.showInformationMessage('全部信息已复制');
            });
        })
    ];

    statusBarItem.show();

    return {
        statusBarItem,
        disposables
    };
}
