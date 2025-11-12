// Tree view of test items

import * as vscode from 'vscode';
import { TestResult } from './types';

export class StacscheckTreeItem extends vscode.TreeItem {
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

export class StacscheckTreeProvider implements vscode.TreeDataProvider<StacscheckTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<StacscheckTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private selectedDirectory: string | undefined;
  private testResults: TestResult[] = [];

  refresh(): void { this._onDidChangeTreeData.fire(); }
  setTestResults(results: TestResult[]) { this.testResults = results; this.refresh(); }
  setSelectedDirectory(path: string) { this.selectedDirectory = path; this.refresh(); }
  getSelectedDirectory(): string | undefined { return this.selectedDirectory; }

  getTreeItem(e: StacscheckTreeItem): StacscheckTreeItem { return e; }

  getChildren(element?: StacscheckTreeItem): Thenable<StacscheckTreeItem[]> {
    // If a test node is expanded, show its raw detail lines as leaf items
    if (element?.details) {
      return Promise.resolve(
        element.details.map(d => new StacscheckTreeItem(d, vscode.TreeItemCollapsibleState.None))
      );
    }

    const items: StacscheckTreeItem[] = [];

    // Button: pick test directory
    let selectDirLabel = 'Select Test Directory';
    const selectDirBtn = new StacscheckTreeItem(
      selectDirLabel,
      vscode.TreeItemCollapsibleState.None,
      { command: 'stacscheck-gui.selectDirectory', title: 'Select Directory', arguments: [] }
    );
    selectDirBtn.iconPath = new vscode.ThemeIcon('folder-opened');
    items.push(selectDirBtn);

    if (this.selectedDirectory) {
      // Show selected path in description instead
      const selectDirItem = items[0];
      selectDirItem.description = vscode.workspace.asRelativePath(this.selectedDirectory);

      // Run tests
      const runBtn = new StacscheckTreeItem(
        'Run Tests',
        vscode.TreeItemCollapsibleState.None,
        { command: 'stacscheck-gui.runTests', title: 'Run Tests', arguments: [] }
      );
      runBtn.iconPath = new vscode.ThemeIcon('play');
      items.push(runBtn);

      // Results with summary + each test
      this.testResults.forEach((t, i) => {
        if (t.type === 'summary') {
          items.push(new StacscheckTreeItem(t.details[0], vscode.TreeItemCollapsibleState.None));
        } else {
          items.push(new StacscheckTreeItem(
            `Test ${i + 1}: ${t.type} - ${t.name} : ${t.result}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            t.details
          ));
        }
      });
    }

    return Promise.resolve(items);
  }
}
