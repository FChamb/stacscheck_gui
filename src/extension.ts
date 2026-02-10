// extension.ts
// Suite discovery now collects metadata (counts + scripts) and the tree displays it.

import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { StacscheckTreeProvider, SuiteInfo } from './treeProvider';
import { parseStacscheckOutput } from './parser';

export function activate(context: vscode.ExtensionContext) {
  const provider = new StacscheckTreeProvider();
  const treeView = vscode.window.createTreeView('stacscheckView', { treeDataProvider: provider });
  context.subscriptions.push(treeView);

  context.subscriptions.push(
    vscode.commands.registerCommand('stacscheck-gui.selectDirectory', () => selectTestDirectory(provider)),
    vscode.commands.registerCommand('stacscheck-gui.setSuite', (suitePath: string) => setSuite(provider, suitePath)),
    vscode.commands.registerCommand('stacscheck-gui.runTests', () => runStacscheck(provider)),
    vscode.commands.registerCommand('stacscheck-gui.addTest', () => addCustomTest(provider))
  );
}

export function deactivate() {}

async function selectTestDirectory(provider: StacscheckTreeProvider): Promise<void> {
  const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file(os.homedir());

  const folderUris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: false,
    canSelectFolders: true,
    openLabel: 'Select stacscheck tests folder',
    title: 'Select the folder containing your stacscheck tests (or a root folder of suites)',
    defaultUri
  });

  if (!folderUris?.length) return;

  const selected = folderUris[0].fsPath;
  provider.setSelectedRootDirectory(selected);

  const suites = await findSuites(selected);
  provider.setSuites(suites);

  // Auto-select: if the selected folder is itself a suite
  const exact = suites.find(s => s.absPath === selected);
  if (exact) {
    provider.setSelectedSuiteDirectory(selected);
    vscode.window.showInformationMessage(`Selected suite: ${exact.label}`);
    return;
  }

  // Auto-select if only one suite found
  if (suites.length === 1) {
    provider.setSelectedSuiteDirectory(suites[0].absPath);
    vscode.window.showInformationMessage(`Selected suite: ${suites[0].label}`);
    return;
  }

  if (suites.length > 1) {
    vscode.window.showInformationMessage('Suites detected. Expand “Suites” and click one to select it.');
  } else {
    vscode.window.showWarningMessage(
      'No suites detected. You can still try running stacscheck from this folder, but it’s usually better to pick a folder containing .in/.out or test scripts.'
    );
  }
}

async function setSuite(provider: StacscheckTreeProvider, suitePath: string): Promise<void> {
  provider.setSelectedSuiteDirectory(suitePath);
  provider.setTestResults([]);

  const rel = vscode.workspace.asRelativePath(suitePath);
  vscode.window.showInformationMessage(`Selected suite: ${rel}`);
}

async function runStacscheck(provider: StacscheckTreeProvider): Promise<void> {
  const testDir = provider.getTargetTestDirectory();
  if (!testDir) {
    vscode.window.showErrorMessage('Please select a test directory first.');
    return;
  }

  const suites = provider.getSuites();
  if (suites.length > 0 && !provider.getSelectedSuiteDirectory()) {
    vscode.window.showErrorMessage('Please select a suite folder (expand “Suites” and click one).');
    return;
  }

  const workingDir = await resolveWorkingDir(testDir, ['src', 'source']);
  if (!workingDir) {
    vscode.window.showErrorMessage('No src/ or source/ directory found. Please select a project folder that contains your code.');
    return;
  }

  const command = getStacscheckCommand(testDir);
  vscode.window.showInformationMessage(`Executing from ${workingDir}: ${command}`);

  exec(command, { cwd: workingDir }, (err, stdout, stderr) => {
    if (err) {
      vscode.window.showErrorMessage(
        `stacscheck finished with an error.\n` +
          `Command: ${command}\n` +
          `Working directory: ${workingDir}\n` +
          `stderr: ${stderr || '(none)'}`
      );
    }

    const parsed = parseStacscheckOutput(stdout || '');
    provider.setTestResults(parsed.tests);
  });
}

function getStacscheckCommand(testDir: string): string {
  const cfg = vscode.workspace.getConfiguration('stacscheckGui');
  const stacscheckPath = cfg.get<string>('stacscheckPath') || '/cs/studres/Library/stacscheck/stacscheck';
  return `"${stacscheckPath}" "${testDir}"`;
}

async function resolveWorkingDir(testsDir: string, srcNames: string[]): Promise<string | undefined> {
  let dir = testsDir;

  for (let i = 0; i < 6; i++) {
    const parent = path.dirname(dir);
    if (!parent || parent === dir) break;

    for (const name of srcNames) {
      const candidate = path.join(parent, name);
      if (isDirectory(candidate)) return candidate;
    }

    dir = parent;
  }

  const wfs = vscode.workspace.workspaceFolders ?? [];
  for (const wf of wfs) {
    for (const name of srcNames) {
      const candidate = path.join(wf.uri.fsPath, name);
      if (isDirectory(candidate)) return candidate;
    }
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: false,
    canSelectFolders: true,
    openLabel: 'Select your code folder (contains src/ or source/)'
  });

  if (!picked?.length) return undefined;

  const chosen = picked[0].fsPath;
  for (const name of srcNames) {
    const candidate = path.join(chosen, name);
    if (isDirectory(candidate)) return candidate;
  }

  return chosen;
}

function isDirectory(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

async function addCustomTest(provider: StacscheckTreeProvider): Promise<void> {
  const targetDir = provider.getTargetTestDirectory();
  if (!targetDir) {
    vscode.window.showErrorMessage('Please select a test directory first.');
    return;
  }

  const suites = provider.getSuites();
  if (suites.length > 0 && !provider.getSelectedSuiteDirectory()) {
    vscode.window.showErrorMessage('Please select a suite folder first (expand “Suites” and click one).');
    return;
  }

  const testName = await vscode.window.showInputBox({
    title: 'Add stacscheck test',
    prompt: 'Name for the new test (used as the file name).',
    placeHolder: 'e.g. factorial_zero',
    ignoreFocusOut: true,
    validateInput: value => (value.trim() ? undefined : 'A test name is required.')
  });
  if (!testName) return;

  const testInput = await vscode.window.showInputBox({
    title: 'Program input',
    prompt: 'Enter the exact input that should be piped to your program.',
    placeHolder: 'You can paste multi-line content.',
    ignoreFocusOut: true,
    value: ''
  });
  if (testInput === undefined) return;

  const expectedOutput = await vscode.window.showInputBox({
    title: 'Expected output',
    prompt: 'Enter the output your program should print for the provided input.',
    placeHolder: 'You can paste multi-line content.',
    ignoreFocusOut: true,
    value: ''
  });
  if (expectedOutput === undefined) return;

  try {
    const { inputPath, outputPath } = await writeCustomTestFiles(targetDir, testName, testInput, expectedOutput);
    vscode.window.showInformationMessage(
      `Created ${path.basename(inputPath)} + ${path.basename(outputPath)} in ${vscode.workspace.asRelativePath(targetDir)}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create test files: ${message}`);
  }
}

async function writeCustomTestFiles(targetDir: string, rawName: string, input: string, expected: string) {
  const baseName = await ensureUniqueBaseName(targetDir, slugify(rawName));
  const inputPath = path.join(targetDir, `${baseName}.in`);
  const outputPath = path.join(targetDir, `${baseName}.out`);

  await fs.promises.writeFile(inputPath, ensureTrailingNewline(input), 'utf8');
  await fs.promises.writeFile(outputPath, ensureTrailingNewline(expected), 'utf8');

  return { inputPath, outputPath };
}

async function ensureUniqueBaseName(targetDir: string, base: string): Promise<string> {
  let candidate = base;
  let counter = 1;

  while (
    await pathExists(path.join(targetDir, `${candidate}.in`)) ||
    await pathExists(path.join(targetDir, `${candidate}.out`))
  ) {
    candidate = `${base}-${counter++}`;
  }

  return candidate;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function slugify(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'stacscheck-test';
}

function ensureTrailingNewline(text: string): string {
  if (!text) return '\n';
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * Suite discovery WITH metadata.
 *
 * A suite folder is heuristically:
 *  - contains at least one *.in, OR
 *  - contains scripts commonly used by stacscheck suites:
 *      prog-run.sh, build-all.sh, test-*.sh
 *
 * Metadata is computed from the immediate folder contents (not recursive):
 *  - inputCount: number of *.in
 *  - outputCount: number of *.out
 *  - hasProgRun / hasBuildAll / testShCount
 */
async function findSuites(rootDir: string): Promise<SuiteInfo[]> {
  const results: SuiteInfo[] = [];
  const seen = new Set<string>();

  const skipNames = new Set(['.git', 'node_modules', '.vscode', 'dist', 'out', 'build', '.idea']);

  async function inspectSuiteFolder(dir: string): Promise<SuiteInfo | undefined> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }

    const fileNames = entries.filter(e => e.isFile()).map(e => e.name);
    const lower = fileNames.map(n => n.toLowerCase());

    const inputCount = lower.filter(f => f.endsWith('.in')).length;
    const outputCount = lower.filter(f => f.endsWith('.out')).length;

    const hasProgRun = lower.includes('prog-run.sh');
    const hasBuildAll = lower.includes('build-all.sh');
    const testShCount = lower.filter(f => f.startsWith('test-') && f.endsWith('.sh')).length;

    const isSuite = inputCount > 0 || hasProgRun || hasBuildAll || testShCount > 0;
    if (!isSuite) return undefined;

    const label = path.relative(rootDir, dir) || path.basename(dir) || dir;
    return { absPath: dir, label, inputCount, outputCount, hasProgRun, hasBuildAll, testShCount };
  }

  async function walk(dir: string, depth: number) {
    if (depth < 0) return;

    const suite = await inspectSuiteFolder(dir);
    if (suite && !seen.has(dir)) {
      seen.add(dir);
      results.push(suite);
      // Keep walking to find nested suites
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    for (const sub of dirs) {
      if (skipNames.has(sub.toLowerCase())) continue;
      await walk(path.join(dir, sub), depth - 1);
    }
  }

  await walk(rootDir, 6);

  results.sort(
    (a, b) =>
      a.label.split(path.sep).length - b.label.split(path.sep).length || a.label.localeCompare(b.label)
  );

  return results;
}