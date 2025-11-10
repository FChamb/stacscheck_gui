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
}

export function deactivate() {}
