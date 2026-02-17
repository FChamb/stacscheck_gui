// treeProvider.ts
// Cleaner Tree UI:
// - Teacher Mode toggle moved to bottom.
// - In Teacher Mode, only ONE extra control: Record toggle.
// - Removed "Set Input" and status rows to reduce clutter.

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
  label: string;
  inputCount: number;
  outputCount: number;
  hasProgRun: boolean;
  hasBuildAll: boolean;
  testShCount: number;
};

export class StacscheckTreeProvider implements vscode.TreeDataProvider<StacscheckTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<StacscheckTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private selectedRootDir: string | undefined;
  private suites: SuiteInfo[] = [];
  private selectedSuiteDir: string | undefined;

  private testResults: TestResult[] = [];

  // Teacher mode state
  private teacherMode = false;
  private recording = false;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // ---------- Tests ----------
  setTestResults(results: TestResult[]): void {
    this.testResults = results;
    this.refresh();
  }

  // ---------- Directories / suites ----------
  setSelectedRootDirectory(dirPath: string): void {
    this.selectedRootDir = dirPath;
    this.selectedSuiteDir = undefined;
    this.testResults = [];
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
    this.testResults = [];
    this.refresh();
  }

  getSelectedSuiteDirectory(): string | undefined {
    return this.selectedSuiteDir;
  }

  getTargetTestDirectory(): string | undefined {
    return this.selectedSuiteDir ?? this.selectedRootDir;
  }

  // ---------- Teacher mode ----------
  setTeacherMode(on: boolean): void {
    this.teacherMode = on;
    if (!on) this.recording = false;
    this.refresh();
  }

  isTeacherMode(): boolean {
    return this.teacherMode;
  }

  setRecording(on: boolean): void {
    this.recording = on;
    this.refresh();
  }

  isRecording(): boolean {
    return this.recording;
  }

  // ---------- Tree plumbing ----------
  getTreeItem(e: StacscheckTreeItem): StacscheckTreeItem {
    return e;
  }

  // In treeProvider.ts, update getChildren() root-level rendering to be data-only.

getChildren(element?: StacscheckTreeItem): Thenable<StacscheckTreeItem[]> {
  if (element?.details) {
    const detailEntries = element.details ?? [];
    return Promise.resolve(detailEntries.map(d => new StacscheckTreeItem(d, vscode.TreeItemCollapsibleState.None)));
  }

  if (element && element.contextValue === 'suiteRoot') {
    // keep your existing suites child logic as-is
    // ...
  }

  const items: StacscheckTreeItem[] = [];

  if (!this.selectedRootDir) {
    const hint = new StacscheckTreeItem('Open the Control Panel to select a test directory.', vscode.TreeItemCollapsibleState.None);
    hint.iconPath = new vscode.ThemeIcon('info');
    items.push(hint);
    return Promise.resolve(items);
  }

  const suitesNode = new StacscheckTreeItem('Suites', vscode.TreeItemCollapsibleState.Collapsed);
  suitesNode.iconPath = new vscode.ThemeIcon('folder-library');
  suitesNode.contextValue = 'suiteRoot';
  suitesNode.description = this.suites.length ? `${this.suites.length} found` : 'None found';
  suitesNode.tooltip = this.selectedRootDir;
  items.push(suitesNode);

  const hasSuites = this.suites.length > 0;
  const ready = this.getTargetTestDirectory() && (!hasSuites || !!this.selectedSuiteDir);

  if (ready) {
    const activeDir = this.getTargetTestDirectory()!;
    const activeLine = new StacscheckTreeItem('Active suite', vscode.TreeItemCollapsibleState.None);
    activeLine.iconPath = new vscode.ThemeIcon('target', new vscode.ThemeColor('charts.blue'));
    activeLine.description = vscode.workspace.asRelativePath(activeDir);
    activeLine.tooltip = activeDir;
    items.push(activeLine);

    // Show results underneath
    items.push(...this.makeResultsItems());
  } else {
    const info = new StacscheckTreeItem('Pick a suite in “Suites” (or use Control Panel).', vscode.TreeItemCollapsibleState.None);
    info.iconPath = new vscode.ThemeIcon('info');
    items.push(info);
  }

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

  private makeRecordToggleButton(): StacscheckTreeItem {
    const isOn = this.recording;

    const label = isOn ? 'Stop Recording Tests' : 'Record Tests';
    const cmd = isOn ? 'stacscheck-gui.stopRecording' : 'stacscheck-gui.startRecording';

    const item = new StacscheckTreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      { command: cmd, title: label, arguments: [] }
    );

    item.iconPath = isOn
      ? new vscode.ThemeIcon('primitive-square', new vscode.ThemeColor('testing.iconFailed'))
      : new vscode.ThemeIcon('record', new vscode.ThemeColor('charts.red'));

    item.description = isOn ? 'Recorder terminal is active' : 'Opens recorder terminal';
    item.tooltip =
      'Recording uses a dedicated terminal.\n' +
      'Run your command there and type/paste the input afterwards.\n' +
      'The typed input becomes the .in, and stdout becomes the .out.';
    return item;
  }

  private makeTeacherModeToggleButton(): StacscheckTreeItem {
    const label = this.teacherMode ? 'Exit Teacher Mode' : 'Enter Teacher Mode';
    const cmd = this.teacherMode ? 'stacscheck-gui.exitTeacherMode' : 'stacscheck-gui.enterTeacherMode';

    const item = new StacscheckTreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      { command: cmd, title: label, arguments: [] }
    );

    item.iconPath = this.teacherMode
      ? new vscode.ThemeIcon('shield', new vscode.ThemeColor('testing.iconPassed'))
      : new vscode.ThemeIcon('shield');

    item.description = this.teacherMode ? 'On' : 'Off';
    item.tooltip = 'Teacher Mode enables fast test recording using a dedicated recorder terminal.';
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

// ---------- Suite meta formatting ----------
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
 * Best-effort formatting/highlighting for failing tests (unchanged)
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