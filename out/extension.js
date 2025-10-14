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
class StacscheckTreeItem extends vscode.TreeItem {
    label;
    collapsibleState;
    command;
    constructor(label, collapsibleState, command) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.command = command;
    }
}
class StacscheckTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    selectedDirectory;
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    setSelectedDirectory(path) {
        this.selectedDirectory = path;
        this.refresh();
    }
    getChildren(element) {
        const items = [];
        // Add "Select Directory" button
        const selectButton = new StacscheckTreeItem('Select Test Directory', vscode.TreeItemCollapsibleState.None, {
            command: 'stacscheck-gui.selectDirectory',
            title: 'Select Directory',
            arguments: []
        });
        selectButton.iconPath = new vscode.ThemeIcon('folder');
        items.push(selectButton);
        // Show current directory if selected
        if (this.selectedDirectory) {
            const currentDir = new StacscheckTreeItem(`Selected: ${vscode.workspace.asRelativePath(this.selectedDirectory)}`, vscode.TreeItemCollapsibleState.None);
            currentDir.iconPath = new vscode.ThemeIcon('folder-opened');
            items.push(currentDir);
            // Add "Run Tests" button
            const runButton = new StacscheckTreeItem('Run Tests', vscode.TreeItemCollapsibleState.None, {
                command: 'stacscheck-gui.runTests',
                title: 'Run Tests',
                arguments: []
            });
            runButton.iconPath = new vscode.ThemeIcon('play');
            items.push(runButton);
        }
        return Promise.resolve(items);
    }
    getSelectedDirectory() {
        return this.selectedDirectory;
    }
}
function activate(context) {
    // Create and register the tree data provider
    const treeDataProvider = new StacscheckTreeProvider();
    const treeView = vscode.window.createTreeView('stacscheckView', {
        treeDataProvider: treeDataProvider
    });
    context.subscriptions.push(treeView);
    // Register the select directory command
    let selectDirCommand = vscode.commands.registerCommand('stacscheck-gui.selectDirectory', async () => {
        const folderUris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: 'Select stacscheck test folder',
            title: 'Select the directory containing your test files'
        });
        if (folderUris && folderUris.length > 0) {
            treeDataProvider.setSelectedDirectory(folderUris[0].fsPath);
        }
    });
    context.subscriptions.push(selectDirCommand);
    // Register the run tests command
    let runTestsCommand = vscode.commands.registerCommand('stacscheck-gui.runTests', async () => {
        const selectedPath = treeDataProvider.getSelectedDirectory();
        if (!selectedPath) {
            vscode.window.showErrorMessage('Please select a test directory first');
            return;
        }
        // Try to find the src directory in the parent of the test directory
        const projectDir = vscode.Uri.file(selectedPath).fsPath.split('/StacscheckTests')[0];
        const srcPath = vscode.Uri.joinPath(vscode.Uri.file(projectDir), 'src').fsPath;
        const sourcePath = vscode.Uri.joinPath(vscode.Uri.file(projectDir), 'source').fsPath;
        // Check if src or source directory exists
        const fs = require('fs');
        let workingDir;
        if (fs.existsSync(srcPath)) {
            workingDir = srcPath;
        }
        else if (fs.existsSync(sourcePath)) {
            workingDir = sourcePath;
        }
        else {
            vscode.window.showErrorMessage('No src or source directory found in the project');
            return;
        }
        // Use the full path to stacscheck, but run it from the src/source directory
        const command = `/cs/studres/Library/stacscheck/stacscheck "${selectedPath}"`;
        vscode.window.showInformationMessage(`Executing from ${workingDir}: ${command}`);
        (0, child_process_1.exec)(command, { cwd: workingDir }, (err, stdout, stderr) => {
            if (err) {
                // Show more detailed error information
                vscode.window.showErrorMessage(`Error running stacscheck:
                Error: ${err}
                stderr: ${stderr}
                Command: ${command}
                Working directory: ${selectedPath}`);
                return;
            }
            // Log the output even if successful
            console.log('stacscheck output:', stdout);
            const panel = vscode.window.createWebviewPanel('stacscheckResults', 'stacscheck Results', vscode.ViewColumn.One, { enableScripts: true });
            const formattedOutput = stdout
                .replace(/\n/g, '<br>')
                .replace(/\s/g, '&nbsp;');
            panel.webview.html = getWebviewContent(formattedOutput);
        });
    });
    context.subscriptions.push(runTestsCommand);
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
function deactivate() { }
//# sourceMappingURL=extension.js.map