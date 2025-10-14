import * as vscode from 'vscode';
import { exec } from 'child_process';
import { get } from 'http';

class StacscheckTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public readonly details?: string[]
    ) {
        super(label, collapsibleState);
        if (label.includes(': pass')) {
            this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
        } else if (label.includes(': fail')) {
            this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        }
    }
}

class StacscheckTreeProvider implements vscode.TreeDataProvider<StacscheckTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<StacscheckTreeItem | undefined | null | void> = new vscode.EventEmitter<StacscheckTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<StacscheckTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private selectedDirectory: string | undefined;
    private testResults: TestResult[] = [];

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
    
    setTestResults(results: TestResult[]) {
        this.testResults = results;
        this.refresh();
    }

    getTreeItem(element: StacscheckTreeItem): StacscheckTreeItem {
        return element;
    }

    setSelectedDirectory(path: string) {
        this.selectedDirectory = path;
        this.refresh();
    }

    getChildren(element?: StacscheckTreeItem): Thenable<StacscheckTreeItem[]> {
        if (element) {
            // If the element has details, return them as child items
            if (element.details) {
                return Promise.resolve(
                    element.details.map(detail => new StacscheckTreeItem(
                        detail,
                        vscode.TreeItemCollapsibleState.None
                    ))
                );
            }
            return Promise.resolve([]);
        }

        const items: StacscheckTreeItem[] = [];

        // Add "Select Directory" button
        const selectButton = new StacscheckTreeItem(
            'Select Test Directory',
            vscode.TreeItemCollapsibleState.None,
            {
                command: 'stacscheck-gui.selectDirectory',
                title: 'Select Directory',
                arguments: []
            }
        );
        selectButton.iconPath = new vscode.ThemeIcon('folder');
        items.push(selectButton);

        // Show current directory if selected
        if (this.selectedDirectory) {
            const currentDir = new StacscheckTreeItem(
                `Selected: ${vscode.workspace.asRelativePath(this.selectedDirectory)}`,
                vscode.TreeItemCollapsibleState.None
            );
            currentDir.iconPath = new vscode.ThemeIcon('folder-opened');
            items.push(currentDir);

            // Add "Run Tests" button
            const runButton = new StacscheckTreeItem(
                'Run Tests',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'stacscheck-gui.runTests',
                    title: 'Run Tests',
                    arguments: []
                }
            );
            runButton.iconPath = new vscode.ThemeIcon('play');
            items.push(runButton);

            // Add test results if available
            this.testResults.forEach((test, index) => {
                if (test.type === 'summary') {
                    const summaryItem = new StacscheckTreeItem(
                        test.details[0],
                        vscode.TreeItemCollapsibleState.None
                    );
                    items.push(summaryItem);
                } else {
                    const testItem = new StacscheckTreeItem(
                        `Test ${index + 1}: ${test.type} - ${test.name} : ${test.result}`,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        undefined,
                        test.details
                    );
                    items.push(testItem);
                }
            });
        }

        return Promise.resolve(items);
    }

    getSelectedDirectory(): string | undefined {
        return this.selectedDirectory;
    }
}

export function activate(context: vscode.ExtensionContext) {
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
        } else if (fs.existsSync(sourcePath)) {
            workingDir = sourcePath;
        } else {
            vscode.window.showErrorMessage('No src or source directory found in the project');
            return;
        }

        // Use the full path to stacscheck, but run it from the src/source directory
        const command = `/cs/studres/Library/stacscheck/stacscheck "${selectedPath}"`;
        vscode.window.showInformationMessage(`Executing from ${workingDir}: ${command}`);

        exec(command, { cwd: workingDir }, (err, stdout, stderr) => {
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

            // Parse the output and update the tree view
            const { tests } = parseStacscheckOutput(stdout);
            treeDataProvider.setTestResults(tests);
        });
    });
    context.subscriptions.push(runTestsCommand);
}

interface TestResult {
    type: string;
    name?: string;
    result?: string;
    details: string[];
}

function parseStacscheckOutput(output: string): { header: string[], tests: TestResult[] } {
    const lines = output.split('\n');
    const tests: TestResult[] = [];
    const header: string[] = [];
    let currentTest: TestResult | null = null;

    lines.forEach(line => {
        if (line.startsWith('* ')) {
            // This is a test line
            const match = line.match(/\* (.*?) - (.*?) : (pass|fail)/);
            if (match) {
                currentTest = {
                    type: match[1],
                    name: match[2],
                    result: match[3],
                    details: [line]
                };
                tests.push(currentTest);
            }
        } else if (line.match(/^\d+ out of \d+ tests passed/)) {
            // Summary line
            tests.push({ type: 'summary', details: [line] });
        } else if (currentTest) {
            // Additional details for the current test
            currentTest.details.push(line);
        } else {
            // Header information
            header.push(line);
        }
    });

    return { header, tests };
}

function getWebviewContent(returnHtml: string): string {
    const { header, tests } = parseStacscheckOutput(returnHtml);
    
    const headerHtml = header.join('<br>');
    const testsHtml = tests.map((test, index) => {
        if (test.type === 'summary') {
            return `<div class="summary">${test.details.join('<br>')}</div>`;
        }

        const icon = test.result === 'pass' ? 
            '<span class="icon pass">✓</span>' : 
            '<span class="icon fail">✗</span>';
        
        return `
            <div class="test-item">
                <button class="collapsible ${test.result}">
                    ${icon} Test ${index + 1}: ${test.name}
                </button>
                <div class="content">
                    <pre>${test.details.join('\n')}</pre>
                </div>
            </div>
        `;
    }).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>stacscheck Results</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    background-color: #1e1e1e;
                    color: #d4d4d4;
                    padding: 1em;
                    line-height: 1.5;
                }
                .test-item {
                    margin: 8px 0;
                }
                .collapsible {
                    background-color: #252526;
                    color: #d4d4d4;
                    cursor: pointer;
                    padding: 12px;
                    width: 100%;
                    border: none;
                    text-align: left;
                    outline: none;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    font-size: 14px;
                }
                .icon {
                    margin-right: 8px;
                    font-weight: bold;
                }
                .pass .icon, .icon.pass {
                    color: #4caf50;
                }
                .fail .icon, .icon.fail {
                    color: #f44336;
                }
                .active {
                    background-color: #2d2d2d;
                }
                .content {
                    padding: 0 18px;
                    max-height: 0;
                    overflow: hidden;
                    transition: max-height 0.2s ease-out;
                    background-color: #1e1e1e;
                    border-bottom-left-radius: 4px;
                    border-bottom-right-radius: 4px;
                }
                .content.show {
                    padding: 12px 18px;
                    max-height: 500px;
                }
                .summary {
                    margin-top: 16px;
                    padding: 12px;
                    background-color: #252526;
                    border-radius: 4px;
                }
                pre {
                    white-space: pre-wrap;
                    word-wrap: break-word;
                    margin: 8px 0;
                    font-family: monospace;
                }
            </style>
        </head>
        <body>
            <h2>stacscheck Results</h2>
            <div class="header">
                ${headerHtml}
            </div>
            <div class="tests">
                ${testsHtml}
            </div>
            <script>
                document.querySelectorAll('.collapsible').forEach(button => {
                    button.addEventListener('click', function() {
                        this.classList.toggle('active');
                        const content = this.nextElementSibling;
                        content.classList.toggle('show');
                    });
                });
            </script>
        </body>
        </html>
    `;
}

export function deactivate() {}