// extension.ts

import * as vscode from 'vscode';
import { exec, spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { StacscheckTreeProvider, SuiteInfo } from './treeProvider';
import { parseStacscheckOutput } from './parser';
import { ControlPanelViewProvider } from './controlPanelView';

export function activate(context: vscode.ExtensionContext) {
  const provider = new StacscheckTreeProvider();

  // Webview: single pane GUI
  const controlPanel = new ControlPanelViewProvider(context, provider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ControlPanelViewProvider.viewType, controlPanel, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Push updates to the control panel whenever state changes
  provider.onDidChangeTreeData(() => controlPanel.postState());

  // Recorder terminal
  const recorder = new RecorderTerminal(provider);

  context.subscriptions.push(
    vscode.commands.registerCommand('stacscheck-gui.selectDirectory', async () => {
      await selectTestDirectory(provider);
      controlPanel.postState();
    }),

    vscode.commands.registerCommand('stacscheck-gui.setSuite', async (suitePath: string) => {
      await setSuite(provider, suitePath);
      controlPanel.postState();
    }),

    vscode.commands.registerCommand('stacscheck-gui.enterTeacherMode', async () => {
      provider.setTeacherMode(true);
      controlPanel.postState();
      vscode.window.showInformationMessage('Teacher Mode enabled.');
    }),

    vscode.commands.registerCommand('stacscheck-gui.exitTeacherMode', async () => {
      provider.setTeacherMode(false);
      recorder.setRecording(false);
      controlPanel.postState();
      vscode.window.showInformationMessage('Teacher Mode disabled.');
    }),

    vscode.commands.registerCommand('stacscheck-gui.startRecording', async () => {
      if (!ensureSuiteSelected(provider)) return;
      provider.setRecording(true);
      recorder.setRecording(true);
      controlPanel.postState();
      recorder.show();
    }),

    vscode.commands.registerCommand('stacscheck-gui.stopRecording', async () => {
      provider.setRecording(false);
      recorder.setRecording(false);
      controlPanel.postState();
    }),

    vscode.commands.registerCommand('stacscheck-gui.runTests', async () => {
      await runStacscheck(provider);
      controlPanel.postState();
    }),

    vscode.commands.registerCommand('stacscheck-gui.addTest', async () => {
      await addCustomTest(provider);
      controlPanel.postState();
    })
  );
}

export function deactivate() {}

// ----------------- Directory + suites -----------------

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

  const exact = suites.find(s => s.absPath === selected);
  if (exact) {
    provider.setSelectedSuiteDirectory(selected);
    vscode.window.showInformationMessage(`Selected suite: ${exact.label}`);
    return;
  }

  if (suites.length === 1) {
    provider.setSelectedSuiteDirectory(suites[0].absPath);
    vscode.window.showInformationMessage(`Selected suite: ${suites[0].label}`);
    return;
  }

  if (suites.length > 1) {
    vscode.window.showInformationMessage('Suites detected. Select one in the Suite dropdown.');
  } else {
    vscode.window.showWarningMessage(
      'No suites detected. You can still run stacscheck on this folder, but it’s usually better to pick a folder containing .in/.out or test scripts.'
    );
  }
}

async function setSuite(provider: StacscheckTreeProvider, suitePath: string): Promise<void> {
  provider.setSelectedSuiteDirectory(suitePath);
}

function ensureSuiteSelected(provider: StacscheckTreeProvider): boolean {
  const testDir = provider.getTargetTestDirectory();
  if (!testDir) {
    vscode.window.showErrorMessage('Select a test directory first.');
    return false;
  }

  const suites = provider.getSuites();
  if (suites.length > 0 && !provider.getSelectedSuiteDirectory()) {
    vscode.window.showErrorMessage('Please select a suite folder.');
    return false;
  }
  return true;
}

// ----------------- Running stacscheck -----------------

async function runStacscheck(provider: StacscheckTreeProvider): Promise<void> {
  const testDir = provider.getTargetTestDirectory();
  if (!testDir) {
    vscode.window.showErrorMessage('Please select a test directory first.');
    return;
  }

  const suites = provider.getSuites();
  if (suites.length > 0 && !provider.getSelectedSuiteDirectory()) {
    vscode.window.showErrorMessage('Please select a suite folder first.');
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

// ----------------- Add Custom Test -----------------

async function addCustomTest(provider: StacscheckTreeProvider): Promise<void> {
  const targetDir = provider.getTargetTestDirectory();
  if (!targetDir) {
    vscode.window.showErrorMessage('Please select a test directory first.');
    return;
  }

  const suites = provider.getSuites();
  if (suites.length > 0 && !provider.getSelectedSuiteDirectory()) {
    vscode.window.showErrorMessage('Please select a suite folder first.');
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
  const base = value.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'stacscheck-test';
}

function ensureTrailingNewline(text: string): string {
  if (!text) return '\n';
  return text.endsWith('\n') ? text : `${text}\n`;
}

// ----------------- Recorder Pseudo Terminal -----------------

class RecorderTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  private closeEmitter = new vscode.EventEmitter<void>();
  onDidClose?: vscode.Event<void> = this.closeEmitter.event;

  private terminal: vscode.Terminal | undefined;

  private recording = false;
  private lineBuffer = '';

  private busy = false;
  private child: ChildProcessWithoutNullStreams | undefined;
  private recordedStdin = '';
  private stdinClosed = false;

  private recordCounter = 1;

  constructor(private provider: StacscheckTreeProvider) {}

  show(): void {
    if (!this.terminal) {
      this.terminal = vscode.window.createTerminal({ name: 'stacscheck Recorder', pty: this });
    }
    this.terminal.show(true);
  }

  setRecording(on: boolean): void {
    this.recording = on;
    this.provider.setRecording(on);
  }

  open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
    this.writeLine('stacscheck Recorder Terminal');
    this.writeLine('Type a command and press Enter.');
    this.writeLine('If Recording is ON: stdin you type/paste becomes the .in, stdout becomes the .out.');
    this.writeLine('Tip: Press Ctrl+D to send EOF if your program reads until EOF.');
    this.writeLine('');
    this.prompt();
  }

  close(): void {
    this.closeEmitter.fire();
  }

  handleInput(data: string): void {
    if (this.busy && this.child && !this.stdinClosed) {
      for (const ch of data) {
        if (ch === '\u0004') {
          this.stdinClosed = true;
          try { this.child.stdin.end(); } catch {}
          this.writeLine('^D');
          continue;
        }
        if (ch === '\u0003') {
          this.writeLine('^C');
          try { this.child.kill('SIGINT'); } catch {}
          continue;
        }
        this.recordedStdin += ch;
        this.write(ch);
        try { this.child.stdin.write(ch); } catch {}
      }
      return;
    }

    for (const ch of data) {
      if (ch === '\r') {
        const cmd = this.lineBuffer.trim();
        this.writeLine('');
        this.lineBuffer = '';

        if (!cmd) { this.prompt(); continue; }

        this.runCommand(cmd).catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          this.writeLine(`[error] ${msg}`);
          this.prompt();
        });
        continue;
      }

      if (ch === '\u0003') {
        this.writeLine('^C');
        this.lineBuffer = '';
        this.prompt();
        continue;
      }

      if (ch === '\u007f') {
        if (this.lineBuffer.length > 0) {
          this.lineBuffer = this.lineBuffer.slice(0, -1);
          this.write('\b \b');
        }
        continue;
      }

      this.lineBuffer += ch;
      this.write(ch);
    }
  }

  private write(text: string): void {
    this.writeEmitter.fire(text);
  }
  private writeLine(text: string): void {
    this.writeEmitter.fire(text + '\r\n');
  }
  private prompt(): void {
    this.write('> ');
  }

  private async runCommand(cmd: string): Promise<void> {
    if (!this.provider.isTeacherMode()) {
      this.writeLine('[info] Enable Teacher Mode first.');
      this.prompt();
      return;
    }
    if (!ensureSuiteSelected(this.provider)) {
      this.writeLine('[info] Select a suite folder first.');
      this.prompt();
      return;
    }

    const suiteDir = this.provider.getTargetTestDirectory()!;
    const workingDir = await resolveWorkingDir(suiteDir, ['src', 'source']);
    if (!workingDir) {
      this.writeLine('[error] No src/ or source/ directory found for this project.');
      this.prompt();
      return;
    }

    this.busy = true;
    this.recordedStdin = '';
    this.stdinClosed = false;

    this.writeLine(`[cwd] ${workingDir}`);
    this.writeLine(`[cmd] ${cmd}`);

    const child = spawn(cmd, { cwd: workingDir, shell: true });
    this.child = child;

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => {
      const s = d.toString();
      stdout += s;
      this.write(s);
    });

    child.stderr.on('data', d => {
      stderr += d.toString();
    });

    const exitCode: number | null = await new Promise(resolve => child.on('close', code => resolve(code)));

    if (stderr.trim()) {
      this.writeLine('\r\n[stderr]');
      this.writeLine(stderr.trimEnd());
    }
    if (exitCode !== 0) {
      this.writeLine(`\r\n[exit] code ${exitCode}`);
    }

    if (this.recording) {
      const base = `recorded-${String(this.recordCounter++).padStart(3, '0')}`;
      const uniqueBase = await ensureUniqueBaseName(suiteDir, base);

      const inPath = path.join(suiteDir, `${uniqueBase}.in`);
      const outPath = path.join(suiteDir, `${uniqueBase}.out`);

      await fs.promises.writeFile(inPath, ensureTrailingNewline(this.recordedStdin), 'utf8');
      await fs.promises.writeFile(outPath, ensureTrailingNewline(stdout), 'utf8');

      this.writeLine(`\r\n[saved] ${path.basename(inPath)} + ${path.basename(outPath)}`);
      vscode.window.showInformationMessage(`Recorded test: ${path.basename(inPath)} / ${path.basename(outPath)}`);
    }

    this.child = undefined;
    this.busy = false;
    this.prompt();
  }
}

// ----------------- Suite discovery WITH metadata -----------------

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
    (a, b) => a.label.split(path.sep).length - b.label.split(path.sep).length || a.label.localeCompare(b.label)
  );

  return results;
}