// treeProvider.ts
// Tree view with suite explorer + suite metadata.
//
// UX improvements:
// - No double checkmark: selection is shown via icon + "Selected" description (not via "✓" text).
// - Suite metadata shown in description (inputs/outs/scripts).
// - Uniform icons + small theme color cues.

import * as vscode from 'vscode';
import { TestResult, TestCaseResult } from './types';

export class StacscheckTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string | vscode.TreeItemLabel,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command,
    public readonly details?: (string | vscode.TreeItemLabel)[]
  ) {
    super(label, collapsibleState);

    // Pass/fail icon decoration for test rows
    const textLabel = typeof label === 'string' ? label : label.label;
    if (textLabel.includes(': pass')) {
      this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    } else if (textLabel.includes(': fail')) {
      this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    }
  }
}

export type SuiteInfo = {
  absPath: string;
  label: string; // usually relative path from root
  inputCount: number; // number of *.in files in this suite folder
  outputCount: number; // number of *.out files in this suite folder
  hasProgRun: boolean;
  hasBuildAll: boolean;
  testShCount: number; // number of test-*.sh scripts
};

export class StacscheckTreeProvider implements vscode.TreeDataProvider<StacscheckTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<StacscheckTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private selectedRootDir: string | undefined;
  private suites: SuiteInfo[] = [];
  private selectedSuiteDir: string | undefined;

  private testResults: TestResult[] = [];

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setTestResults(results: TestResult[]): void {
    this.testResults = results;
    this.refresh();
  }

  setSelectedRootDirectory(dirPath: string): void {
    this.selectedRootDir = dirPath;
    this.refresh();
  }

  getSelectedRootDirectory(): string | undefined {
    return this.selectedRootDir;
  }

  setSuites(suites: SuiteInfo[]): void {
    this.suites = suites;

    const stillValid = this.selectedSuiteDir && suites.some(s => s.absPath === this.selectedSuiteDir);
    if (!stillValid) this.selectedSuiteDir = undefined;

    this.refresh();
  }

  getSuites(): SuiteInfo[] {
    return this.suites;
  }

  setSelectedSuiteDirectory(dirPath: string | undefined): void {
    this.selectedSuiteDir = dirPath;
    this.refresh();
  }

  getSelectedSuiteDirectory(): string | undefined {
    return this.selectedSuiteDir;
  }

  getTargetTestDirectory(): string | undefined {
    return this.selectedSuiteDir ?? this.selectedRootDir;
  }

  getTreeItem(e: StacscheckTreeItem): StacscheckTreeItem {
    return e;
  }

  getChildren(element?: StacscheckTreeItem): Thenable<StacscheckTreeItem[]> {
    // Expanded test node -> show details lines
    if (element?.details) {
      const detailEntries = element.details ?? [];
      return Promise.resolve(detailEntries.map(d => new StacscheckTreeItem(d, vscode.TreeItemCollapsibleState.None)));
    }

    // Suites node children
    if (element && element.contextValue === 'suiteRoot') {
      const suiteItems = this.suites.map(suite => {
        const isSelected = this.selectedSuiteDir === suite.absPath;

        const item = new StacscheckTreeItem(
          suite.label,
          vscode.TreeItemCollapsibleState.None,
          { command: 'stacscheck-gui.setSuite', title: 'Set Suite', arguments: [suite.absPath] }
        );

        // Clean selection indicator: icon + description (no extra "✓" in label)
        if (isSelected) {
          item.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
          item.description = 'Selected';
        } else {
          item.iconPath = new vscode.ThemeIcon('file-directory');
          item.description = formatSuiteMetaShort(suite);
        }

        item.tooltip = formatSuiteTooltip(suite);
        item.contextValue = 'suiteItem';
        return item;
      });

      if (!suiteItems.length) {
        const help = new StacscheckTreeItem(
          'No suites detected (pick a folder containing .in/.out or test scripts)',
          vscode.TreeItemCollapsibleState.None
        );
        help.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
        return Promise.resolve([help]);
      }

      return Promise.resolve(suiteItems);
    }

    // Root level tree
    const items: StacscheckTreeItem[] = [];

    items.push(this.makeSelectDirectoryButton());

    if (!this.selectedRootDir) {
      // helpful empty state
      const hint = new StacscheckTreeItem('Select a test folder to begin', vscode.TreeItemCollapsibleState.None);
      hint.iconPath = new vscode.ThemeIcon('info');
      items.push(hint);
      return Promise.resolve(items);
    }

    // Suites group
    const suitesNode = new StacscheckTreeItem('Suites', vscode.TreeItemCollapsibleState.Collapsed);
    suitesNode.iconPath = new vscode.ThemeIcon('folder-library');
    suitesNode.contextValue = 'suiteRoot';

    const hasSuites = this.suites.length > 0;
    suitesNode.description = hasSuites
      ? `${this.suites.length} found`
      : 'None found';
    suitesNode.tooltip = this.selectedRootDir;

    items.push(suitesNode);

    // Readiness gate:
    // - If suites exist, require selecting one (prevents running in the wrong folder).
    // - If no suites exist, allow root fallback.
    const ready = this.getTargetTestDirectory() && (!hasSuites || !!this.selectedSuiteDir);

    if (!ready) {
      const msg = hasSuites
        ? 'Pick a suite in “Suites” to run tests / add tests'
        : 'No suites detected; you can still try running tests using the selected folder';
      const info = new StacscheckTreeItem(msg, vscode.TreeItemCollapsibleState.None);
      info.iconPath = new vscode.ThemeIcon('info');
      items.push(info);
      return Promise.resolve(items);
    }

    // Show which suite is active (small “context” line)
    const activeDir = this.getTargetTestDirectory()!;
    const activeLine = new StacscheckTreeItem('Active suite', vscode.TreeItemCollapsibleState.None);
    activeLine.iconPath = new vscode.ThemeIcon('target', new vscode.ThemeColor('charts.blue'));
    activeLine.description = vscode.workspace.asRelativePath(activeDir);
    activeLine.tooltip = activeDir;
    items.push(activeLine);

    items.push(this.makeRunTestsButton());
    items.push(...this.makeResultsItems());
    items.push(this.makeAddCustomTestButton());

    return Promise.resolve(items);
  }

  private makeSelectDirectoryButton(): StacscheckTreeItem {
    const item = new StacscheckTreeItem(
      'Select Test Directory',
      vscode.TreeItemCollapsibleState.None,
      { command: 'stacscheck-gui.selectDirectory', title: 'Select Directory', arguments: [] }
    );
    item.iconPath = new vscode.ThemeIcon('folder-opened');
    if (this.selectedRootDir) {
      item.description = vscode.workspace.asRelativePath(this.selectedRootDir);
      item.tooltip = this.selectedRootDir;
    }
    return item;
  }

  private makeRunTestsButton(): StacscheckTreeItem {
    const item = new StacscheckTreeItem(
      'Run Tests',
      vscode.TreeItemCollapsibleState.None,
      { command: 'stacscheck-gui.runTests', title: 'Run Tests', arguments: [] }
    );
    item.iconPath = new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.green'));
    return item;
  }

  private makeAddCustomTestButton(): StacscheckTreeItem {
    const item = new StacscheckTreeItem(
      'Add Custom Test',
      vscode.TreeItemCollapsibleState.None,
      { command: 'stacscheck-gui.addTest', title: 'Add Custom Test', arguments: [] }
    );
    item.iconPath = new vscode.ThemeIcon('diff-added');
    return item;
  }

  private makeResultsItems(): StacscheckTreeItem[] {
    const items: StacscheckTreeItem[] = [];

    let passCount = 0;
    let totalTests = 0;
    let displayIndex = 1;

    for (const t of this.testResults) {
      if (t.kind === 'summary') {
        const line = t.details[0] ?? 'Summary';
        const summaryItem = new StacscheckTreeItem(line, vscode.TreeItemCollapsibleState.None);
        summaryItem.iconPath = new vscode.ThemeIcon('graph');
        items.push(summaryItem);
        continue;
      }

      totalTests++;
      if (t.outcome === 'pass') passCount++;

      items.push(
        new StacscheckTreeItem(
          `Test ${displayIndex++}: ${t.type} - ${t.name} : ${t.outcome}`,
          vscode.TreeItemCollapsibleState.Collapsed,
          undefined,
          formatTestDetails(t)
        )
      );
    }

    if (totalTests > 0) {
      const progressPercentage = (passCount / totalTests) * 100;
      const barLength = 20;
      const filledLength = Math.round((passCount / totalTests) * barLength);
      const progressBar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
      const barItem = new StacscheckTreeItem(`${progressBar} ${progressPercentage.toFixed(0)}%`, vscode.TreeItemCollapsibleState.None);
      barItem.iconPath = new vscode.ThemeIcon('dashboard');
      items.push(barItem);
    }

    return items;
  }
}

function formatSuiteMetaShort(s: SuiteInfo): string {
  const parts: string[] = [];
  parts.push(`${s.inputCount} in`);
  if (s.outputCount > 0) parts.push(`${s.outputCount} out`);

  const scriptBits: string[] = [];
  if (s.hasProgRun) scriptBits.push('prog-run.sh');
  if (s.hasBuildAll) scriptBits.push('build-all.sh');
  if (s.testShCount > 0) scriptBits.push(`test-*.sh×${s.testShCount}`);

  if (scriptBits.length) parts.push(scriptBits.join(', '));
  return parts.join(' • ');
}

function formatSuiteTooltip(s: SuiteInfo): string {
  const lines: string[] = [];
  lines.push(s.absPath);
  lines.push('');
  lines.push(`Inputs (*.in): ${s.inputCount}`);
  lines.push(`Outputs (*.out): ${s.outputCount}`);
  lines.push(`prog-run.sh: ${s.hasProgRun ? 'yes' : 'no'}`);
  lines.push(`build-all.sh: ${s.hasBuildAll ? 'yes' : 'no'}`);
  lines.push(`test-*.sh scripts: ${s.testShCount}`);
  return lines.join('\n');
}

/**
 * Best-effort formatting/highlighting for failing tests (unchanged from your earlier version)
 */
function formatTestDetails(test: TestCaseResult): (string | vscode.TreeItemLabel)[] {
  const rawDetails = test.details ?? [];
  if (!rawDetails.length || test.outcome !== 'fail') return rawDetails;

  const expectedInfo = findValueLine(rawDetails, expectedPatterns);
  const actualInfo = findValueLine(rawDetails, actualPatterns);

  if (!expectedInfo || !actualInfo) return rawDetails;

  const diff = diffValueSegments(expectedInfo.value, actualInfo.value);
  if (!diff) return rawDetails;

  const highlightMap = new Map<number, [number, number][]>();

  const expectedRange = translateRange(expectedInfo.range, diff.expected, expectedInfo.value.length);
  if (expectedRange) highlightMap.set(expectedInfo.index, [expectedRange]);

  const actualRange = translateRange(actualInfo.range, diff.actual, actualInfo.value.length);
  if (actualRange) highlightMap.set(actualInfo.index, [actualRange]);

  if (!highlightMap.size) return rawDetails;

  return rawDetails.map((line, idx) => {
    const highlights = highlightMap.get(idx);
    return highlights ? { label: line, highlights } : line;
  });
}

type DetailValueLine = {
  index: number;
  value: string;
  range: [number, number];
};

const expectedPatterns = [/\bexpected output\b/i, /\bexpected\b/i, /\bcorrect output\b/i];
const actualPatterns = [/\bactual output\b/i, /\bactual\b/i, /\byour output\b/i, /\bstudent output\b/i, /\bgot\b/i, /\breceived\b/i];

function findValueLine(lines: string[], patterns: RegExp[]): DetailValueLine | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = findFirstMatch(line, patterns);
    if (!match || typeof match.index !== 'number') continue;

    const keywordIndex = match.index + match[0].length;
    const valueInfo = extractValueSegment(line, keywordIndex);
    if (!valueInfo) continue;

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
  if (!trimmed) return undefined;

  const start = afterSeparatorIndex + startOffset;
  const end = start + trimmed.length;
  return { value: trimmed, range: [start, end] };
}

function findSeparatorIndex(line: string, from: number): number | undefined {
  const colon = line.indexOf(':', from);
  const equals = line.indexOf('=', from);
  const candidates = [colon, equals].filter(idx => idx >= 0);
  if (!candidates.length) return undefined;
  return Math.min(...candidates) + 1;
}

function diffValueSegments(expected: string, actual: string) {
  if (expected === actual) return undefined;

  let start = 0;
  const maxStart = Math.min(expected.length, actual.length);
  while (start < maxStart && expected[start] === actual[start]) start++;

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
    if (valueLength === 0) return undefined;
    return [baseRange[0], baseRange[1]];
  }
  return [baseRange[0] + diffRange[0], baseRange[0] + diffRange[1]];
}

function findFirstMatch(text: string, patterns: RegExp[]): RegExpExecArray | undefined {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) return match;
  }
  return undefined;
}