import * as vscode from 'vscode';
import { exec, spawn } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { StacscheckTreeProvider, SuiteInfo } from './treeProvider';
import { parseStacscheckOutput } from './parser';
import { ControlPanelViewProvider } from './controlPanelView';

type WizardPayload = {
  testsRoot: string;
  practicalName: string;
  courseCode: string;
  srcDir: string;
  compileCommand: string;
  runCommand: string;
  suiteNamesRaw: string;
  includeCheckStyle: boolean;
};

type ActiveExecution = {
  commandLine: string;
  cwd: string | undefined;
};

export function activate(context: vscode.ExtensionContext) {
  const provider = new StacscheckTreeProvider();

  const controlPanel = new ControlPanelViewProvider(context, provider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ControlPanelViewProvider.viewType, controlPanel, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  provider.onDidChangeTreeData(() => controlPanel.postState());

  const recorder = new ShellRecorder(provider);
  context.subscriptions.push(recorder);

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
      provider.setRecorderStatus('Teacher Mode enabled.');
      controlPanel.postState();
      vscode.window.showInformationMessage('Teacher Mode enabled.');
    }),

    vscode.commands.registerCommand('stacscheck-gui.exitTeacherMode', async () => {
      provider.setTeacherMode(false);
      recorder.setRecording(false);
      provider.setRecorderStatus('Teacher Mode disabled.');
      controlPanel.postState();
      vscode.window.showInformationMessage('Teacher Mode disabled.');
    }),

    vscode.commands.registerCommand('stacscheck-gui.setRecorderInput', async (value: string) => {
      provider.setRecorderInput(value ?? '');
      controlPanel.postState();
    }),

    vscode.commands.registerCommand('stacscheck-gui.createSuiteFromWizard', async (payload: WizardPayload) => {
      if (!provider.isTeacherMode()) {
        vscode.window.showErrorMessage('Enable Teacher Mode first.');
        return;
      }

      await createSuiteFromWizard(provider, payload);
      controlPanel.postState();
    }),

    vscode.commands.registerCommand('stacscheck-gui.startRecording', async () => {
      if (!ensureSuiteSelected(provider)) return;
      recorder.setRecording(true);
      await recorder.show();
      controlPanel.postState();
    }),

    vscode.commands.registerCommand('stacscheck-gui.stopRecording', async () => {
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
  await loadSuiteState(provider, folderUris[0].fsPath);
}

async function setSuite(provider: StacscheckTreeProvider, suitePath: string): Promise<void> {
  provider.setSelectedSuiteDirectory(suitePath);
}

async function loadSuiteState(
  provider: StacscheckTreeProvider,
  rootDir: string,
  preferredSuite?: string
): Promise<void> {
  provider.setSelectedRootDirectory(rootDir);

  const suites = await findSuites(rootDir);
  provider.setSuites(suites);

  if (preferredSuite && suites.some(s => s.absPath === preferredSuite)) {
    provider.setSelectedSuiteDirectory(preferredSuite);
    return;
  }

  const exact = suites.find(s => s.absPath === rootDir);
  if (exact) {
    provider.setSelectedSuiteDirectory(rootDir);
    return;
  }

  if (suites.length === 1) {
    provider.setSelectedSuiteDirectory(suites[0].absPath);
  }
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

async function createSuiteFromWizard(provider: StacscheckTreeProvider, payload: WizardPayload): Promise<void> {
  const testsRoot = (payload.testsRoot || '').trim();
  const practicalName = (payload.practicalName || '').trim();
  const courseCode = (payload.courseCode || '').trim();
  const srcDir = (payload.srcDir || '').trim();
  const compileCommand = (payload.compileCommand || '').trim();
  const runCommand = (payload.runCommand || '').trim();
  const suiteNames = parseSuiteNames(payload.suiteNamesRaw || '');

  if (!testsRoot || !practicalName || !courseCode || !srcDir || !compileCommand || !runCommand) {
    vscode.window.showErrorMessage('Wizard is missing one or more required fields.');
    return;
  }

  if (!suiteNames.length) {
    vscode.window.showErrorMessage('Please provide at least one suite name.');
    return;
  }

  const created = await createSuiteWizardFiles({
    testsRoot,
    practicalName,
    courseCode,
    srcDir,
    compileCommand,
    runCommand,
    suiteNames,
    includeCheckStyle: !!payload.includeCheckStyle
  });

  await loadSuiteState(provider, testsRoot, created.firstSuitePath);

  vscode.window.showInformationMessage(
    `Created stacscheck scaffold in ${testsRoot}${created.includeCheckStyle ? ' with CheckStyle scaffold' : ''}.`
  );
}

function parseSuiteNames(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of raw.split(',')) {
    const cleaned = part.trim().replace(/[\\\\]+/g, '/');
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }

  return result;
}

function getCheckstyleConfigFileName(courseCode: string): string {
  const stem = courseCode.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${stem || 'course'}_checks.xml`;
}

async function createSuiteWizardFiles(args: {
  testsRoot: string;
  practicalName: string;
  courseCode: string;
  srcDir: string;
  compileCommand: string;
  runCommand: string;
  suiteNames: string[];
  includeCheckStyle: boolean;
}): Promise<{ firstSuitePath: string; includeCheckStyle: boolean }> {
  await fs.promises.mkdir(args.testsRoot, { recursive: true });

  const practicalConfigPath = path.join(args.testsRoot, 'practical.config');
  await writeFileIfMissing(
    practicalConfigPath,
    `[info]
practical = ${args.practicalName}
course = ${args.courseCode}
srcdir = ${args.srcDir}
`
  );

  const firstSuitePath = path.join(args.testsRoot, ...args.suiteNames[0].split('/'));

  for (const suiteName of args.suiteNames) {
    const suiteDir = path.join(args.testsRoot, ...suiteName.split('/'));
    await fs.promises.mkdir(suiteDir, { recursive: true });

    const buildAllPath = path.join(suiteDir, 'build-all.sh');
    const progRunPath = path.join(suiteDir, 'prog-run.sh');

    await writeFileIfMissing(
      buildAllPath,
      `#!/bin/bash
set -e

${args.compileCommand}
`
    );

    await writeFileIfMissing(
      progRunPath,
      `#!/bin/bash

${args.runCommand}
`
    );

    await makeExecutable(buildAllPath);
    await makeExecutable(progRunPath);
  }

  if (args.includeCheckStyle) {
    const checkStyleDir = path.join(args.testsRoot, 'CheckStyle');
    const libsDir = path.join(args.testsRoot, 'libs');
    const checkstyleConfigFileName = getCheckstyleConfigFileName(args.courseCode);

    await fs.promises.mkdir(checkStyleDir, { recursive: true });
    await fs.promises.mkdir(libsDir, { recursive: true });

    const buildAllPath = path.join(checkStyleDir, 'build-all.sh');
    const testScriptPath = path.join(checkStyleDir, 'test-CheckStyle.sh');
    const xmlPath = path.join(checkStyleDir, checkstyleConfigFileName);
    const libsReadmePath = path.join(libsDir, 'README.txt');

    await writeFileIfMissing(
      buildAllPath,
      `#!/bin/bash
set -e

${args.compileCommand}
`
    );

    await writeFileIfMissing(
      testScriptPath,
      `#!/bin/bash

JAR_PATH="$TESTDIR/../libs/checkstyle-11.0.1-all.jar"
CONFIG_PATH="$TESTDIR/${checkstyleConfigFileName}"

if [ ! -f "$JAR_PATH" ]; then
    echo "Missing CheckStyle jar: $JAR_PATH"
    echo "Place checkstyle-11.0.1-all.jar inside the libs directory."
    exit 1
fi

result=$(java -jar "$JAR_PATH" -c "$CONFIG_PATH" .)
echo "$result"

pass=$'Starting audit...\\nAudit done.'
if [ "$result" != "$pass" ]; then
    echo "Code does not adhere to style conventions."
    exit 1
else
    echo "Code adheres to style conventions."
    exit 0
fi
`
    );

    await writeFileIfMissing(
      xmlPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE module PUBLIC "-//Puppy Crawl//DTD Check Configuration 1.3//EN" "http://www.puppycrawl.com/dtds/configuration_1_3.dtd">

<!--
    Checkstyle-Configuration: St Andrews Checkstyle Configuration
    Description: Presents the naming conventions that are used within NDS research group.
-->
<module name="Checker">
  <property name="severity" value="warning"/>
  <property name="fileExtensions" value="java, properties, xml"/>

  <module name="TreeWalker">
    <module name="JavadocMethod">
      <property name="scope" value="public"/>
      <property name="allowUndeclaredRTE" value="true"/>
      <property name="severity" value="ignore"/>
    </module>
    <module name="JavadocType">
      <property name="scope" value="public"/>
      <property name="severity" value="ignore"/>
    </module>
    <module name="JavadocVariable">
      <property name="scope" value="public"/>
      <property name="severity" value="ignore"/>
    </module>
    <module name="JavadocStyle">
      <property name="checkEmptyJavadoc" value="true"/>
      <property name="checkHtml" value="false"/>
    </module>
    <module name="ConstantName"/>
    <module name="LocalFinalVariableName">
      <property name="format" value="^[a-z][a-zA-Z0-9_]*$"/>
    </module>
    <module name="LocalVariableName">
      <property name="format" value="^[a-z][a-zA-Z0-9_]*$"/>
    </module>
    <module name="MemberName">
      <property name="format" value="^[a-z][a-zA-Z0-9_]*$"/>
    </module>
    <module name="MethodName"/>
    <module name="PackageName"/>
    <module name="ParameterName">
      <property name="format" value="^[a-z][a-zA-Z0-9_]*$"/>
    </module>
    <module name="StaticVariableName">
      <property name="format" value="^[a-z][a-zA-Z0-9_]*$"/>
    </module>
    <module name="TypeName">
      <property name="format" value="^[a-zA-Z0-9]*$"/>
      <property name="tokens" value="INTERFACE_DEF"/>
    </module>
    <module name="AvoidStarImport"/>
    <module name="IllegalImport"/>
    <module name="RedundantImport"/>
    <module name="MethodLength">
      <property name="severity" value="ignore"/>
      <metadata name="net.sf.eclipsecs.core.lastEnabledSeverity" value="inherit"/>
    </module>
    <module name="ParameterNumber">
      <property name="severity" value="ignore"/>
      <metadata name="net.sf.eclipsecs.core.lastEnabledSeverity" value="inherit"/>
    </module>
    <module name="EmptyForIteratorPad"/>
    <module name="GenericWhitespace"/>
    <module name="Indentation"/>
    <module name="MethodParamPad"/>
    <module name="NoWhitespaceAfter"/>
    <module name="NoWhitespaceBefore"/>
    <module name="OperatorWrap"/>
    <module name="ParenPad"/>
    <module name="TypecastParenPad"/>
    <module name="WhitespaceAfter"/>
    <module name="WhitespaceAround">
      <property name="tokens" value="ASSIGN,BAND,BAND_ASSIGN,BOR,BOR_ASSIGN,BSR,BSR_ASSIGN,BXOR,BXOR_ASSIGN,COLON,DIV,DIV_ASSIGN,EQUAL,GE,GT,LAND,LCURLY,LE,LITERAL_ASSERT,LITERAL_CATCH,LITERAL_DO,LITERAL_ELSE,LITERAL_FINALLY,LITERAL_FOR,LITERAL_IF,LITERAL_RETURN,LITERAL_SYNCHRONIZED,LITERAL_TRY,LITERAL_WHILE,LOR,LT,MINUS,MINUS_ASSIGN,MOD,MOD_ASSIGN,NOT_EQUAL,PLUS,PLUS_ASSIGN,QUESTION,SL,SLIST,SL_ASSIGN,SR,SR_ASSIGN,STAR,STAR_ASSIGN,LITERAL_ASSERT,TYPE_EXTENSION_AND,WILDCARD_TYPE"/>
    </module>
    <module name="ModifierOrder"/>
    <module name="RedundantModifier"/>
    <module name="AvoidNestedBlocks"/>
    <module name="EmptyBlock">
      <property name="tokens" value="LITERAL_DO,LITERAL_ELSE,LITERAL_FINALLY,LITERAL_IF,LITERAL_FOR,LITERAL_TRY,LITERAL_WHILE,STATIC_INIT"/>
    </module>
    <module name="LeftCurly"/>
    <module name="NeedBraces"/>
    <module name="EmptyStatement"/>
    <module name="EqualsHashCode"/>
    <module name="IllegalInstantiation"/>
    <module name="InnerAssignment"/>
    <module name="MagicNumber">
        <property name="severity" value="ignore"/>
    </module>
    <module name="MissingSwitchDefault"/>
    <!--<module name="RedundantThrows"/> -->
    <module name="SimplifyBooleanExpression"/>
    <module name="SimplifyBooleanReturn"/>
    <module name="DesignForExtension">
      <property name="severity" value="ignore"/>
      <metadata name="net.sf.eclipsecs.core.lastEnabledSeverity" value="inherit"/>
    </module>
    <module name="FinalClass"/>
    <module name="InterfaceIsType"/>
    <module name="VisibilityModifier">
      <property name="protectedAllowed" value="true"/>
    </module>
    <module name="ArrayTypeStyle"/>
    <!--   <module name="FinalParameters"/> -->
    <module name="TodoComment"/>
    <module name="UpperEll"/>
    <module name="EmptyLineSeparator">
      <property name="allowNoEmptyLineBetweenFields" value="true"/>
      <property name="allowMultipleEmptyLines" value="false"/>
      <property name="allowMultipleEmptyLinesInsideClassMembers" value="false"/>
    </module>
  </module>
  <!--  <module name="JavadocPackage"/> -->
  <module name="NewlineAtEndOfFile">
    <property name="severity" value="ignore"/>
  </module>
  <module name="Translation"/>
  <module name="FileLength"/>
  <module name="FileTabCharacter"/>
  <module name="RegexpSingleline">
    <metadata name="net.sf.eclipsecs.core.comment" value="Trailing space or tab after text (but allow one space after javadoc *)"/>
    <property name="format" value="[^*][\\s\\t]$"/>
    <property name="message" value="Line has trailing spaces or tabs."/>
    <property name="severity" value="ignore"/>
  </module>
  <module name="RegexpSingleline">
    <metadata name="net.sf.eclipsecs.core.comment" value="Space or tab on empty line"/>
    <property name="format" value="^[\\s\\t]+$"/>
    <property name="message" value="Line has trailing spaces or tabs."/>
    <!--<property name="severity" value="ignore"/>-->
  </module>
</module>
`
    );

    await writeFileIfMissing(
      libsReadmePath,
      `Place the CheckStyle jar here if you want to use the CheckStyle scaffold.

Expected file name:
checkstyle-11.0.1-all.jar
`
    );

    await makeExecutable(buildAllPath);
    await makeExecutable(testScriptPath);
  }

  return {
    firstSuitePath,
    includeCheckStyle: args.includeCheckStyle
  };
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  const exists = await pathExists(filePath);
  if (!exists) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf8');
  }
}

async function makeExecutable(filePath: string): Promise<void> {
  try {
    await fs.promises.chmod(filePath, 0o755);
  } catch {
    // ignore
  }
}

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

class ShellRecorder implements vscode.Disposable {
  private terminal: vscode.Terminal | undefined;
  private readonly terminalName = 'stacscheck Recorder';
  private readonly activeExecutions = new Map<vscode.TerminalShellExecution, ActiveExecution>();
  private readonly disposables: vscode.Disposable[] = [];
  private recording = false;
  private recordCounter = 1;

  constructor(private readonly provider: StacscheckTreeProvider) {
    this.disposables.push(
      vscode.window.onDidChangeTerminalShellIntegration((event) => {
        if (event.terminal !== this.terminal) return;

        this.provider.setRecorderStatus(
          event.shellIntegration
            ? 'Recorder terminal ready. Run a command there to capture it.'
            : 'Recorder terminal opened. Waiting for shell integration...'
        );
      }),

      vscode.window.onDidStartTerminalShellExecution((event) => {
        if (!this.recording || event.terminal !== this.terminal) return;

        const cwd = extractExecutionCwd(event);
        this.activeExecutions.set(event.execution, {
          commandLine: event.execution.commandLine.value,
          cwd
        });

        this.provider.setRecorderStatus(`Captured command: ${event.execution.commandLine.value}`);
      }),

      vscode.window.onDidEndTerminalShellExecution((event) => {
        if (event.terminal !== this.terminal) return;

        const active = this.activeExecutions.get(event.execution);
        if (!active) return;

        void this.finishExecution(active, event.exitCode);
        this.activeExecutions.delete(event.execution);
      })
    );
  }

  async show(): Promise<void> {
    const term = this.getOrCreateTerminal();
    term.show(true);

    if (term.shellIntegration) {
      this.provider.setRecorderStatus('Recorder terminal ready. Run a command there to capture it.');
      return;
    }

    this.provider.setRecorderStatus('Recorder terminal opened. Waiting for shell integration...');
    await delay(1500);

    if (this.terminal === term && !term.shellIntegration) {
      this.provider.setRecorderStatus(
        'Shell integration is not active yet. Commands will not be captured until it activates.'
      );
    }
  }

  setRecording(on: boolean): void {
    this.recording = on;
    this.provider.setRecording(on);

    if (on) {
      this.provider.setRecorderStatus('Recording enabled. Run one command in the stacscheck Recorder terminal.');
    } else {
      this.provider.setRecorderStatus('Recording disabled.');
    }
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private getOrCreateTerminal(): vscode.Terminal {
    if (!this.terminal || this.terminal.exitStatus) {
      this.terminal = vscode.window.createTerminal({
        name: this.terminalName,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      });
    }
    return this.terminal;
  }

  private async finishExecution(active: ActiveExecution, exitCode: number | undefined): Promise<void> {
    const suiteDir = this.provider.getTargetTestDirectory();
    if (!suiteDir) {
      this.provider.setRecorderStatus('Command ended, but no suite is selected.');
      return;
    }

    if (!this.recording) {
      this.provider.setRecorderStatus(`Command finished: ${active.commandLine}`);
      return;
    }

    const rerunCwd = await this.resolveRecorderCwd(active.cwd, suiteDir);
    if (!rerunCwd) {
      this.provider.setRecorderStatus('Could not determine a valid working directory for rerunning the recorded command.');
      return;
    }

    const stdinText = this.provider.getRecorderInput();
    const rerun = await runCommandForRecording(active.commandLine, rerunCwd, stdinText);

    const base = `recorded-${String(this.recordCounter++).padStart(3, '0')}`;
    const uniqueBase = await ensureUniqueBaseName(suiteDir, base);

    const inPath = path.join(suiteDir, `${uniqueBase}.in`);
    const outPath = path.join(suiteDir, `${uniqueBase}.out`);

    await fs.promises.writeFile(inPath, ensureTrailingNewline(stdinText), 'utf8');
    await fs.promises.writeFile(outPath, ensureTrailingNewline(rerun.stdout), 'utf8');

    const exitText = rerun.exitCode === null || rerun.exitCode === undefined
      ? 'unknown exit code'
      : `exit ${rerun.exitCode}`;

    if (rerun.stderr.trim()) {
      vscode.window.showWarningMessage(
        `Recorded test saved, but the rerun command wrote to stderr: ${truncateOneLine(rerun.stderr)}`
      );
    }

    if (exitCode !== undefined && rerun.exitCode !== exitCode) {
      this.provider.setRecorderStatus(
        `Saved ${path.basename(inPath)} and ${path.basename(outPath)}. Note: rerun exit code (${String(rerun.exitCode)}) differed from terminal exit code (${exitCode}).`
      );
    } else {
      this.provider.setRecorderStatus(`Saved ${path.basename(inPath)} and ${path.basename(outPath)} (${exitText}).`);
    }

    vscode.window.showInformationMessage(`Recorded test: ${path.basename(inPath)} / ${path.basename(outPath)}`);
  }

  private async resolveRecorderCwd(executionCwd: string | undefined, suiteDir: string): Promise<string | undefined> {
    if (executionCwd && isDirectory(executionCwd)) {
      return executionCwd;
    }

    const fallback = await resolveWorkingDir(suiteDir, ['src', 'source']);
    return fallback;
  }
}

function extractExecutionCwd(event: vscode.TerminalShellExecutionStartEvent): string | undefined {
  const shellIntegration = event.terminal.shellIntegration;
  if (!shellIntegration) return undefined;

  try {
    const cwdValue = shellIntegration.cwd;
    if (typeof cwdValue === 'string') return cwdValue;
    if (cwdValue && typeof cwdValue.fsPath === 'string') return cwdValue.fsPath;
  } catch {
    // ignore
  }

  return undefined;
}

async function runCommandForRecording(
  command: string,
  cwd: string,
  stdinText: string
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      resolve({
        stdout: normalizeProgramOutput(stdout),
        stderr: normalizeProgramOutput(stderr),
        exitCode: code
      });
    });

    try {
      child.stdin.write(stdinText);
      child.stdin.end();
    } catch {
      // ignore
    }
  });
}

function normalizeProgramOutput(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function truncateOneLine(value: string, max = 120): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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