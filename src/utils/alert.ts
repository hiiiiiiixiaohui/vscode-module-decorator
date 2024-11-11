import * as vscode from 'vscode';
import * as path from 'path';

export function alert() {
    vscode.window.showWarningMessage(`src${path.sep}pages目录下不存在!`);
    vscode.window.showWarningMessage(`工作目录必须包含config${path.sep}routes.ts文件!`);
    vscode.window.showWarningMessage('可通过配置修改extensionmodulemap.moduleSourceMapPath和extensionmodulemap.routeConfigPath设置路径!');
}