import * as vscode from 'vscode';
import path from 'path';

// 显示模块标签的函数
export function showModuleTag(editor: vscode.TextEditor, moduleInfo: Record<string, any>) {
    // 创建装饰器
    const decorationType = vscode.window.createTextEditorDecorationType({
        before: {
            contentText: `[${moduleInfo.moduleName}]`,
            color: '#888888',
            margin: '0 8px 0 0'
        }
    });

    // 创建固定在右侧的标签
    const lastLine = editor.document.lineCount - 1;
    const lastLineLength = editor.document.lineAt(lastLine).text.length;
    const range = new vscode.Range(
        new vscode.Position(0, lastLineLength),
        new vscode.Position(0, lastLineLength)
    );

    editor.setDecorations(decorationType, [{
        range,
        renderOptions: {
            after: {
                contentText: `[Name]: ${moduleInfo.moduleName} [Route]: ${moduleInfo.routePath} [Path]: ${moduleInfo.filePath.split('src/')[1]}]`,
                color: '#888888',
                margin: '0 0 0 8px',
                backgroundColor: '#f0f0f0',
                border: '1px solid #ddd',
                fontStyle: 'normal'
            }
        }
    }]);
}
