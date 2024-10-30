import * as vscode from 'vscode';

// 显示模块标签的函数
export function showModuleTag(editor: vscode.TextEditor, moduleName: string) {
    // 创建装饰器
    const decorationType = vscode.window.createTextEditorDecorationType({
        before: {
            contentText: `[${moduleName}]`,
            color: '#888888',
            margin: '0 8px 0 0'
        }
    });

    // 应用装饰器到第一行
    const range = new vscode.Range(0, 0, 0, 0);
    editor.setDecorations(decorationType, [{
        range
    }]);
}
