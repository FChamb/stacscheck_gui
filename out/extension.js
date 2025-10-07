"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
function activate(context) {
    let disposable = vscode.commands.registerCommand('stacscheck-gui.runTests', () => {
        vscode.window.showOpenDialog({ canSelectFiles: true }).then(folder => {
            if (!folder) {
                return;
            }
            const testPath = folder[0].fsPath;
            const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '.';
            (0, child_process_1.exec)(`stacscheck "${testPath}"`, { cwd: workspacePath }, (err, stdout, stderr) => {
                if (err) {
                    vscode.window.showErrorMessage(`Error running stacscheck: ${stderr}`);
                    return;
                }
                const panel = vscode.window.createWebviewPanel('stacscheckResults', 'stacscheck Results', vscode.ViewColumn.One, { enableScripts: true });
                const formattedOutput = stdout
                    .replace(/\n/g, '<br>')
                    .replace(/\s/g, '&nbsp;');
                panel.webview.html = getWebviewContent(formattedOutput);
            });
        });
    });
    context.subscriptions.push(disposable);
}
function getWebviewContent(returnHtml) {
    return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>stacscheck Results</title>
			<style>
				body {
					font-family: monospace;
					background-color: #1e1e1e;
					color: #d4d4d4;
					padding: 1em;
				}
				.pass { color: #4caf50; }
				.fail { color: #f44336; }
				pre {
					white-space: pre-wrap;
					word-wrap: break-word;
				}
					</style>
					</head>
					<body>
					<h2>stacscheck Results</h2>
					<pre>${returnHtml}</pre>
					</body>
					</html>
	`;
}
// This method is called when your extension is deactivated
function deactivate() { }
//# sourceMappingURL=extension.js.map