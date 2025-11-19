// Entry point of extention. Registers the TreeView and commands

import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as os from 'os';
import { StacscheckTreeProvider } from './treeProvider';
import { parseStacscheckOutput } from './parser';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  // Create and register the tree
  const provider = new StacscheckTreeProvider();
  const treeView = vscode.window.createTreeView('stacscheckView', { treeDataProvider: provider });
  context.subscriptions.push(treeView);

  // Command for select test directory
  const selectDir = vscode.commands.registerCommand('stacscheck-gui.selectDirectory', async () => {
    const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file(os.homedir());
    const folderUris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: false,
      canSelectFolders: true,
      openLabel: 'Select stacscheck test folder',
      title: 'Select the directory containing your test files',
      defaultUri
    });

    if (folderUris?.length) {
      provider.setSelectedDirectory(folderUris[0].fsPath);
    }
  });
  context.subscriptions.push(selectDir);

  // Command for run stacscheck in src/source of the project that owns the tests
  const runTests = vscode.commands.registerCommand('stacscheck-gui.runTests', async () => {
  const selectedPath = provider.getSelectedDirectory();
  if (!selectedPath) {
    vscode.window.showErrorMessage('Please select a test directory first');
    return;
  }

  // 1) Resolve a working directory that contains src/ or source/
  const srcNames = ['src', 'source'];
  const workingDir = await resolveWorkingDir(selectedPath, srcNames);

  if (!workingDir) {
    vscode.window.showErrorMessage('No src or source directory found. Please select a project folder that contains your code.');
    return;
  }

  // 2) Run stacscheck exactly as before
  const command = `/cs/studres/Library/stacscheck/stacscheck "${selectedPath}"`;
  vscode.window.showInformationMessage(`Executing from ${workingDir}: ${command}`);

  exec(command, { cwd: workingDir }, (err, stdout, stderr) => {
    if (err) {
      vscode.window.showErrorMessage(
        `Error running stacscheck:
            Error: ${err}
            stderr: ${stderr}
            Command: ${command}
            Working directory: ${selectedPath}`
      );
      return;
    }

    console.log('stacscheck output:', stdout);

    const { tests } = parseStacscheckOutput(stdout);
    provider.setTestResults(tests);

  });
});

async function resolveWorkingDir(testsDir: string, srcNames: string[]): Promise<string | undefined> {
  let dir = testsDir;
  for (let i = 0; i < 6; i++) {
    const parent = path.dirname(dir);
    if (!parent || parent === dir) break;

    for (const name of srcNames) {
      const candidate = path.join(parent, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    }
    dir = parent;
  }

  const wfs = vscode.workspace.workspaceFolders ?? [];
  for (const wf of wfs) {
    for (const name of srcNames) {
      const candidate = path.join(wf.uri.fsPath, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    }
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: false,
    canSelectFolders: true,
    openLabel: 'Select your code folder (contains src/ or source)'
  });
  if (picked?.length) {
    const chosen = picked[0].fsPath;
    for (const name of srcNames) {
      const candidate = path.join(chosen, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    }
    // Assume they selected the actual working dir
    return chosen;
  }

  return undefined;
}

context.subscriptions.push(runTests);

  const addCustomTest = vscode.commands.registerCommand('stacscheck-gui.addTest', async () => {
    const selectedPath = provider.getSelectedDirectory();
    if (!selectedPath) {
      vscode.window.showErrorMessage('Please select a test directory before creating a test.');
      return;
    }

    const testName = await vscode.window.showInputBox({
      title: 'Add stacscheck test',
      prompt: 'Name for the new test (used as the file name).',
      placeHolder: 'e.g. factorial_zero',
      ignoreFocusOut: true,
      validateInput: value => value.trim() ? undefined : 'A test name is required.'
    });
    if (!testName) { return; }

    const testInput = await vscode.window.showInputBox({
      title: 'Program input',
      prompt: 'Enter the exact input that should be piped to your program.',
      placeHolder: 'You can paste multi-line content.',
      ignoreFocusOut: true,
      value: ''
    });
    if (testInput === undefined) { return; }

    const expectedOutput = await vscode.window.showInputBox({
      title: 'Expected output',
      prompt: 'Enter the output your program should print for the provided input.',
      placeHolder: 'You can paste multi-line content.',
      ignoreFocusOut: true,
      value: ''
    });
    if (expectedOutput === undefined) { return; }

    try {
      const { inputPath, expectedPath } = await writeCustomTestFiles(selectedPath, testName, testInput, expectedOutput);
      vscode.window.showInformationMessage(`Created ${path.basename(inputPath)} and ${path.basename(expectedPath)}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to create test files: ${message}`);
    }
  });

  context.subscriptions.push(addCustomTest);
}

export function deactivate() {}

async function writeCustomTestFiles(targetDir: string, rawName: string, input: string, expected: string) {
  const baseName = await ensureUniqueBaseName(targetDir, slugify(rawName));
  const inputPath = path.join(targetDir, `${baseName}.in`);
  const expectedPath = path.join(targetDir, `${baseName}.expected`);

  await fs.promises.writeFile(inputPath, ensureTrailingNewline(input), 'utf8');
  await fs.promises.writeFile(expectedPath, ensureTrailingNewline(expected), 'utf8');

  return { inputPath, expectedPath };
}

async function ensureUniqueBaseName(targetDir: string, base: string) {
  let candidate = base;
  let counter = 1;
  while (
    await pathExists(path.join(targetDir, `${candidate}.in`)) ||
    await pathExists(path.join(targetDir, `${candidate}.expected`))
  ) {
    candidate = `${base}-${counter++}`;
  }
  return candidate;
}

async function pathExists(filePath: string) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function slugify(value: string) {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return base || 'stacscheck-test';
}

function ensureTrailingNewline(text: string) {
  if (!text) { return '\n'; }
  return text.endsWith('\n') ? text : `${text}\n`;
}
