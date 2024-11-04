import * as vscode from 'vscode';

// 显示模块标签的函数
export function showModuleTag(editor: vscode.TextEditor, moduleInfo: Record<string, any>) {
    // // 创建装饰器
    // const decorationType = vscode.window.createTextEditorDecorationType({
    //     before: {
    //         contentText: '',
    //         color: '#888888',
    //     }
    // });

    // // 创建固定在右侧的标签
    // const lastLine = editor.document.lineCount - 1;
    // const lastLineLength = editor.document.lineAt(lastLine).text.length;
    // const range = new vscode.Range(
    //     new vscode.Position(0, lastLineLength),
    //     new vscode.Position(0, lastLineLength)
    // );

    // editor.setDecorations(decorationType, [{
    //     range,
    //     renderOptions: {
    //         after: {
    //             contentText: `[Name]: ${moduleInfo.moduleName} [Route]: ${moduleInfo.routePath} [Path]: ${moduleInfo.filePath.split('src/')[1]}]`,
    //             color: '#888888',
    //             margin: '0 0 0 8px',
    //             backgroundColor: '#f0f0f0',
    //             border: '1px solid #ddd',
    //             fontStyle: 'normal'
    //         }
    //     }
    // }]);

    // 创建状态栏项-右下角
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    // 模块名称
    const moduleName = Array.isArray(moduleInfo.moduleNames) && moduleInfo.moduleNames.length > 1 ? moduleInfo.moduleNames.filter(Boolean).join(' / ') : moduleInfo.moduleNames.filter(Boolean)[0] ?? 'Not Found';
    const hideInMenu = moduleInfo?.hideInMenu ?? false;
    // 设置状态栏显示的文本
    statusBarItem.text = `$(tag) ${moduleName}`;


    // 创建悬停提示内容
    const tooltipContent = new vscode.MarkdownString();
    tooltipContent.isTrusted = true;
    tooltipContent.supportHtml = true;

    tooltipContent.appendMarkdown(`### 模块信息\n\n`);
    tooltipContent.appendMarkdown(`- 模块名称: ${moduleName} [复制](command:extensionmodulemap.copyModuleName)\n`);
    tooltipContent.appendMarkdown(`- IsHideInMenu: ${String(hideInMenu).toUpperCase()} [复制](command:extensionmodulemap.copyHideInMenu)\n`);
    tooltipContent.appendMarkdown(`- 页面路由: ${moduleInfo.routePath} [复制](command:extensionmodulemap.copyRoutePath)\n`);
    tooltipContent.appendMarkdown(`- 文件路径: ${moduleInfo.filePath.split('src/')[1]} [复制](command:extensionmodulemap.copyFilePath)\n`);
    tooltipContent.appendMarkdown(`\n[复制全部信息](command:extensionmodulemap.copyAllInfo)`);

    statusBarItem.tooltip = tooltipContent;

    // 注册复制命令
    const disposables = [
        vscode.commands.registerCommand('extensionmodulemap.copyModuleName', () => {
            vscode.env.clipboard.writeText(moduleName).then(() => {
                vscode.window.showInformationMessage('模块名称已复制');
            });
        }),
        vscode.commands.registerCommand('extensionmodulemap.copyHideInMenu', () => {
            vscode.env.clipboard.writeText(hideInMenu).then(() => {
                vscode.window.showInformationMessage('是否隐藏已复制');
            });
        }),
        vscode.commands.registerCommand('extensionmodulemap.copyRoutePath', () => {
            vscode.env.clipboard.writeText(moduleInfo.routePath).then(() => {
                vscode.window.showInformationMessage('路由已复制');
            });
        }),
        vscode.commands.registerCommand('extensionmodulemap.copyFilePath', () => {
            vscode.env.clipboard.writeText(moduleInfo.filePath.split('src/')[1]).then(() => {
                vscode.window.showInformationMessage('路径已复制');
            });
        }),
        vscode.commands.registerCommand('extensionmodulemap.copyAllInfo', () => {
            const moduleText = `模块名称: ${moduleName}\n路由: ${moduleInfo.routePath}\n路径: ${moduleInfo.filePath.split('src/')[1]}`;
            vscode.env.clipboard.writeText(moduleText).then(() => {
                vscode.window.showInformationMessage('全部信息已复制');
            });
        })
    ];

    // 显示状态栏
    statusBarItem.show();

    // 返回状态栏项和disposables以便后续可以销毁
    return {
        statusBarItem,
        disposables
    };
}
