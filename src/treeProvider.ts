// Tree view of test items

import * as vscode from 'vscode';
import { TestResult } from './types';

export class StacscheckTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string | vscode.TreeItemLabel,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command,
    public readonly details?: (string | vscode.TreeItemLabel)[]
  ) {
    super(label, collapsibleState);

    const textLabel = typeof label === 'string' ? label : label.label;
    if (textLabel.includes(': pass')) {
      this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    } else if (textLabel.includes(': fail')) {
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
      const detailEntries = element.details ?? [];
      return Promise.resolve(
        detailEntries.map(d => new StacscheckTreeItem(d, vscode.TreeItemCollapsibleState.None))
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
      let passCount = 0;
      let totalTests = 0;
      
      this.testResults.forEach((t, i) => {
        if (t.type === 'summary') {
          items.push(new StacscheckTreeItem(t.details[0], vscode.TreeItemCollapsibleState.None));
        } else {
          totalTests++;
          if (t.result === 'pass') {
            passCount++;
          }
          items.push(new StacscheckTreeItem(
            `Test ${i + 1}: ${t.type} - ${t.name} : ${t.result}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            formatTestDetails(t)
          ));
        }
      });

      // Add progress bar after summary
      if (totalTests > 0) {
        const progressPercentage = (passCount / totalTests) * 100;
        const barLength = 20;
        const filledLength = Math.round((passCount / totalTests) * barLength);
        const progressBar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
        const progressLabel = `${progressBar} ${progressPercentage.toFixed(0)}%`;
        
        const progressItem = new StacscheckTreeItem(progressLabel, vscode.TreeItemCollapsibleState.None);
        items.push(progressItem);
      }

      const addTestItem = new StacscheckTreeItem(
        'Add Custom Test',
        vscode.TreeItemCollapsibleState.None,
        { command: 'stacscheck-gui.addTest', title: 'Add Custom Test', arguments: [] }
      );
      addTestItem.iconPath = new vscode.ThemeIcon('diff-added');
      items.push(addTestItem);
    }

    return Promise.resolve(items);
  }
}

function formatTestDetails(test: TestResult): (string | vscode.TreeItemLabel)[] {
  const rawDetails = test.details ?? [];
  if (!rawDetails.length || test.result !== 'fail') {
    return rawDetails;
  }

  const expectedInfo = findValueLine(rawDetails, expectedPatterns);
  const actualInfo = findValueLine(rawDetails, actualPatterns);

  if (!expectedInfo || !actualInfo) {
    return rawDetails;
  }

  const diff = diffValueSegments(expectedInfo.value, actualInfo.value);
  if (!diff) {
    return rawDetails;
  }

  const highlightMap = new Map<number, [number, number][]>();
  const expectedRange = translateRange(expectedInfo.range, diff.expected, expectedInfo.value.length);
  if (expectedRange) {
    highlightMap.set(expectedInfo.index, [expectedRange]);
  }

  const actualRange = translateRange(actualInfo.range, diff.actual, actualInfo.value.length);
  if (actualRange) {
    highlightMap.set(actualInfo.index, [actualRange]);
  }

  if (!highlightMap.size) {
    return rawDetails;
  }

  return rawDetails.map((line, idx) => {
    const highlights = highlightMap.get(idx);
    if (!highlights) {
      return line;
    }
    return { label: line, highlights };
  });
}

type DetailValueLine = {
  index: number;
  value: string;
  range: [number, number];
};

const expectedPatterns = [
  /\bexpected output\b/i,
  /\bexpected\b/i,
  /\bcorrect output\b/i
];
const actualPatterns = [
  /\bactual output\b/i,
  /\bactual\b/i,
  /\byour output\b/i,
  /\bstudent output\b/i,
  /\bgot\b/i,
  /\breceived\b/i
];

function findValueLine(lines: string[], patterns: RegExp[]): DetailValueLine | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = findFirstMatch(line, patterns);
    if (!match || typeof match.index !== 'number') {
      continue;
    }
    const keywordIndex = match.index + match[0].length;
    const valueInfo = extractValueSegment(line, keywordIndex);
    if (!valueInfo) {
      continue;
    }
    return { index: i, ...valueInfo };
  }

  return undefined;
}

function extractValueSegment(line: string, searchStart: number): { value: string; range: [number, number] } | undefined {
  const separatorIndex = findSeparatorIndex(line, searchStart);
  const afterSeparatorIndex = separatorIndex ?? searchStart;
  const remainder = line.slice(afterSeparatorIndex);
  const leadingWhitespace = remainder.match(/^\s*/) ?? [''];
  const startOffset = leadingWhitespace[0].length;
  const trimmed = remainder.slice(startOffset).trimEnd();

  if (!trimmed) {
    return undefined;
  }

  const start = afterSeparatorIndex + startOffset;
  const end = start + trimmed.length;
  return { value: trimmed, range: [start, end] };
}

function findSeparatorIndex(line: string, from: number): number | undefined {
  const colon = line.indexOf(':', from);
  const equals = line.indexOf('=', from);
  const candidates = [colon, equals].filter(idx => idx >= 0);
  if (!candidates.length) {
    return undefined;
  }
  return Math.min(...candidates) + 1;
}

function diffValueSegments(expected: string, actual: string) {
  if (expected === actual) {
    return undefined;
  }

  let start = 0;
  const maxStart = Math.min(expected.length, actual.length);
  while (start < maxStart && expected[start] === actual[start]) {
    start++;
  }

  let endExpected = expected.length;
  let endActual = actual.length;

  while (endExpected > start && endActual > start && expected[endExpected - 1] === actual[endActual - 1]) {
    endExpected--;
    endActual--;
  }

  return {
    expected: [start, endExpected] as [number, number],
    actual: [start, endActual] as [number, number]
  };
}

function translateRange(baseRange: [number, number], diffRange: [number, number], valueLength: number): [number, number] | undefined {
  if (diffRange[0] === diffRange[1]) {
    if (valueLength === 0) {
      return undefined;
    }
    return [baseRange[0], baseRange[1]];
  }
  return [baseRange[0] + diffRange[0], baseRange[0] + diffRange[1]];
}

function findFirstMatch(text: string, patterns: RegExp[]): RegExpExecArray | undefined {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      return match;
    }
  }
  return undefined;
}
