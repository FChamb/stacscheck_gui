import * as vscode from 'vscode';
import { exec } from 'child_process';
import { get } from 'http';

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('stacscheck-gui.runTests', () => {
		vscode.window.showOpenDialog({ canSelectFiles: true }).then(folder => {
			if (!folder) { 
				return;
			}

			const testPath = folder[0].fsPath;
			const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '.';

			exec(`stacscheck "${testPath}"`, { cwd: workspacePath }, (err, stdout, stderr) => {
				if (err) {
					vscode.window.showErrorMessage(`Error running stacscheck: ${stderr}`);
					return;
				}

				const panel = vscode.window.createWebviewPanel(
					'stacscheckResults',
					'stacscheck Results',
					vscode.ViewColumn.One,
					{ enableScripts: true }
				);

				const formattedOutput = stdout
					.replace(/\n/g, '<br>')
					.replace(/\s/g, '&nbsp;');

				panel.webview.html = getWebviewContent(formattedOutput);
			});
		});
	});

	context.subscriptions.push(disposable);
}

function getWebviewContent(returnHtml: string): string {
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
export function deactivate() {}
