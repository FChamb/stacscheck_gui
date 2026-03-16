// controlPanelView.ts
// Full sidebar GUI (webview) for stacscheck.
// Includes:
// - Setup
// - Suite selection
// - Actions
// - Teacher tools
// - Results
// - In-panel multi-step startup wizard with presets + live preview

import * as vscode from 'vscode';
import { StacscheckTreeProvider, SuiteInfo } from './treeProvider';
import { TestResult } from './types';

type ControlState = {
  rootDir?: string;
  suites: SuiteInfo[];
  selectedSuiteDir?: string;
  targetDir?: string;
  teacherMode: boolean;
  recording: boolean;
  results: TestResult[];
};

export class ControlPanelViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'stacscheckControl';

  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: StacscheckTreeProvider
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg?.type) {
          case 'selectDirectory':
            await vscode.commands.executeCommand('stacscheck-gui.selectDirectory');
            break;

          case 'runTests':
            await vscode.commands.executeCommand('stacscheck-gui.runTests');
            break;

          case 'addTest':
            await vscode.commands.executeCommand('stacscheck-gui.addTest');
            break;

          case 'toggleTeacherMode': {
            const on = !!msg?.on;
            await vscode.commands.executeCommand(on ? 'stacscheck-gui.enterTeacherMode' : 'stacscheck-gui.exitTeacherMode');
            break;
          }

          case 'toggleRecording': {
            const on = !!msg?.on;
            await vscode.commands.executeCommand(on ? 'stacscheck-gui.startRecording' : 'stacscheck-gui.stopRecording');
            break;
          }

          case 'setSuite': {
            const suitePath = String(msg?.suitePath ?? '');
            if (suitePath) {
              await vscode.commands.executeCommand('stacscheck-gui.setSuite', suitePath);
            }
            break;
          }

          case 'submitWizard':
            await vscode.commands.executeCommand('stacscheck-gui.createSuiteFromWizard', msg.payload);
            break;

          case 'requestState':
            this.postState();
            break;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Control panel error: ${message}`);
      }
    });

    this.postState();
  }

  public postState(): void {
    if (!this.view) return;
    this.view.webview.postMessage({ type: 'state', state: this.getState() });
  }

  private getState(): ControlState {
    return {
      rootDir: this.provider.getSelectedRootDirectory(),
      suites: this.provider.getSuites(),
      selectedSuiteDir: this.provider.getSelectedSuiteDirectory(),
      targetDir: this.provider.getTargetTestDirectory(),
      teacherMode: this.provider.isTeacherMode(),
      recording: this.provider.isRecording(),
      results: this.provider.getTestResults()
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             img-src ${webview.cspSource} https:;
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>stacscheck GUI</title>

  <style>
    :root {
      --pad: 12px;
      --gap: 10px;
      --radius: 10px;
      --muted: var(--vscode-descriptionForeground);
      --border: color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
      --bg: var(--vscode-sideBar-background);
      --card: color-mix(in srgb, var(--vscode-editorWidget-background) 75%, transparent);
      --ok: var(--vscode-testing-iconPassed, #2ea043);
      --bad: var(--vscode-testing-iconFailed, #f85149);
      --warn: var(--vscode-testing-iconQueued, #d29922);
    }

    body {
      margin: 0;
      padding: var(--pad);
      background: var(--bg);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.35;
    }

    .container {
      display: flex;
      flex-direction: column;
      gap: var(--gap);
      min-height: calc(100vh - (2 * var(--pad)));
    }

    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 10px;
    }

    .title {
      font-weight: 650;
      margin-bottom: 6px;
    }

    .subtitle {
      font-weight: 600;
      margin-bottom: 8px;
    }

    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .col {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .muted {
      color: var(--muted);
      font-size: 0.9em;
    }

    label {
      font-size: 0.92em;
      margin-bottom: 4px;
      display: block;
    }

    input, textarea, button, select {
      font: inherit;
    }

    input, textarea, select {
      width: 100%;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      box-sizing: border-box;
    }

    textarea {
      min-height: 72px;
      resize: vertical;
    }

    button {
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
    }

    button.secondary {
      background: transparent;
      color: var(--vscode-foreground);
    }

    button.warning {
      background: transparent;
      color: var(--warn);
    }

    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .divider {
      height: 1px;
      background: var(--border);
      margin: 8px 0;
    }

    .spacer { flex: 1; }

    .bottomBar {
      position: sticky;
      bottom: 0;
      background: var(--bg);
      padding-top: 10px;
    }

    .toggle {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }

    .pill {
      padding: 4px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      font-size: 0.85em;
    }

    .progress {
      width: 100%;
      height: 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      overflow: hidden;
      background: transparent;
    }

    .progressFill {
      height: 100%;
      width: 0%;
      background: var(--ok);
    }

    .test {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px;
      background: color-mix(in srgb, var(--card) 55%, transparent);
      margin-top: 8px;
    }

    .testHeader {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }

    .badge {
      font-size: 0.85em;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      white-space: nowrap;
    }

    .badge.pass { color: var(--ok); }
    .badge.fail { color: var(--bad); }

    pre {
      margin: 8px 0 0 0;
      padding: 8px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--vscode-textCodeBlock-background);
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .wizardHidden {
      display: none;
    }

    .wizardSteps {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }

    .wizardStep {
      padding: 4px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      font-size: 0.85em;
    }

    .wizardStep.active {
      color: var(--ok);
      border-color: var(--ok);
    }

    .grid2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .previewBox {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px;
      background: var(--vscode-textCodeBlock-background);
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
      max-height: 260px;
      overflow: auto;
    }
  </style>
</head>

<body>
  <div class="container">

    <div class="card">
      <div class="title">Setup</div>
      <div class="row" style="justify-content: space-between;">
        <button id="btnSelectDir">Select Test Directory</button>
        <span class="pill" id="pillReady">No folder</span>
      </div>
      <div class="muted" id="textRootDir" style="margin-top: 8px;">No directory selected.</div>
    </div>

    <div class="card">
      <div class="title">Suite</div>
      <div class="muted" style="margin-bottom: 8px;">
        Pick the suite folder where tests will be created and run.
      </div>
      <select id="suiteSelect" disabled>
        <option value="">No suites</option>
      </select>
      <div class="muted" id="textSuiteMeta" style="margin-top: 8px;"></div>
    </div>

    <div class="card">
      <div class="title">Actions</div>
      <div class="row">
        <button id="btnRun" disabled>Run Tests</button>
        <button id="btnAdd" class="secondary" disabled>Add Custom Test</button>
      </div>

      <div class="divider"></div>

      <div class="title" style="font-weight: 600;">Teacher</div>
      <div class="muted" style="margin-bottom: 8px;">
        Use the setup wizard to scaffold a fresh suite, or the recorder terminal to generate many tests quickly.
      </div>
      <div class="row">
        <button id="btnWizard" class="warning" disabled>Start Setup Wizard</button>
        <button id="btnRecord" class="secondary" disabled>Record Tests</button>
      </div>
      <div class="muted" id="textRecordHint" style="margin-top: 8px;"></div>
    </div>

    <div class="card wizardHidden" id="wizardCard">
      <div class="title">Setup Wizard</div>
      <div class="wizardSteps">
        <span class="wizardStep" id="stepPill1">1. Template</span>
        <span class="wizardStep" id="stepPill2">2. Details</span>
        <span class="wizardStep" id="stepPill3">3. Suites</span>
        <span class="wizardStep" id="stepPill4">4. Preview</span>
      </div>

      <div id="wizardStep1">
        <div class="subtitle">Choose a template</div>
        <label for="wizardPreset">Preset</label>
        <select id="wizardPreset">
          <option value="java-basic">Java basic</option>
          <option value="java-checkstyle">Java with CheckStyle</option>
          <option value="python-basic">Python basic</option>
          <option value="c-basic">C basic</option>
          <option value="custom">Custom</option>
        </select>
        <div class="muted">This fills sensible defaults for compile/run commands and suite layout.</div>
      </div>

      <div id="wizardStep2" class="wizardHidden">
        <div class="subtitle">Project details</div>
        <div class="col">
          <div>
            <label for="wizardTestsRoot">Test root folder</label>
            <input id="wizardTestsRoot" />
          </div>
          <div class="grid2">
            <div>
              <label for="wizardPracticalName">Practical name</label>
              <input id="wizardPracticalName" />
            </div>
            <div>
              <label for="wizardCourseCode">Course code</label>
              <input id="wizardCourseCode" />
            </div>
          </div>
          <div>
            <label for="wizardSrcDir">Source directory</label>
            <input id="wizardSrcDir" />
          </div>
          <div>
            <label for="wizardCompileCommand">Build command</label>
            <input id="wizardCompileCommand" />
          </div>
          <div>
            <label for="wizardRunCommand">Run command</label>
            <input id="wizardRunCommand" />
          </div>
          <div>
            <label for="wizardIncludeCheckStyle">Include CheckStyle scaffold</label>
            <select id="wizardIncludeCheckStyle">
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </div>
        </div>
      </div>

      <div id="wizardStep3" class="wizardHidden">
        <div class="subtitle">Suite structure</div>
        <label for="wizardSuitePreset">Suite layout</label>
        <select id="wizardSuitePreset">
          <option value="single">Single suite</option>
          <option value="options">Option-style nested suites</option>
          <option value="custom">Custom list</option>
        </select>

        <div style="margin-top:8px;">
          <label for="wizardSuiteNames">Suite names</label>
          <textarea id="wizardSuiteNames"></textarea>
          <div class="muted">
            For custom lists, use comma-separated paths like:
            <code>basic</code> or <code>option1/words, option1/names</code>
          </div>
        </div>
      </div>

      <div id="wizardStep4" class="wizardHidden">
        <div class="subtitle">Preview</div>
        <div class="muted">These folders and files will be created.</div>
        <div class="previewBox" id="wizardPreview"></div>
      </div>

      <div class="divider"></div>

      <div class="row" style="justify-content: space-between;">
        <div class="row">
          <button id="btnWizardCancel" class="secondary">Cancel</button>
        </div>
        <div class="row">
          <button id="btnWizardBack" class="secondary">Back</button>
          <button id="btnWizardNext">Next</button>
          <button id="btnWizardCreate" class="warning wizardHidden">Create Suite</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="title">Results</div>
      <div class="row" style="justify-content: space-between;">
        <div class="muted" id="textSummary">No results yet.</div>
        <span class="pill" id="pillPassFail">—</span>
      </div>
      <div class="progress" style="margin-top: 8px;">
        <div class="progressFill" id="progressFill"></div>
      </div>
      <div id="resultsList"></div>
    </div>

    <div class="spacer"></div>

    <div class="bottomBar">
      <div class="card">
        <div class="toggle">
          <div>
            <div class="title" style="margin: 0;">Teacher Mode</div>
            <div class="muted">Enables the setup wizard and recording tools.</div>
          </div>
          <button id="btnTeacherMode" class="secondary">Enter</button>
        </div>
      </div>
    </div>

  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const els = {
      btnSelectDir: document.getElementById('btnSelectDir'),
      pillReady: document.getElementById('pillReady'),
      textRootDir: document.getElementById('textRootDir'),

      suiteSelect: document.getElementById('suiteSelect'),
      textSuiteMeta: document.getElementById('textSuiteMeta'),

      btnRun: document.getElementById('btnRun'),
      btnAdd: document.getElementById('btnAdd'),
      btnWizard: document.getElementById('btnWizard'),
      btnRecord: document.getElementById('btnRecord'),
      textRecordHint: document.getElementById('textRecordHint'),

      textSummary: document.getElementById('textSummary'),
      pillPassFail: document.getElementById('pillPassFail'),
      progressFill: document.getElementById('progressFill'),
      resultsList: document.getElementById('resultsList'),

      btnTeacherMode: document.getElementById('btnTeacherMode'),

      wizardCard: document.getElementById('wizardCard'),
      stepPill1: document.getElementById('stepPill1'),
      stepPill2: document.getElementById('stepPill2'),
      stepPill3: document.getElementById('stepPill3'),
      stepPill4: document.getElementById('stepPill4'),
      wizardStep1: document.getElementById('wizardStep1'),
      wizardStep2: document.getElementById('wizardStep2'),
      wizardStep3: document.getElementById('wizardStep3'),
      wizardStep4: document.getElementById('wizardStep4'),

      wizardPreset: document.getElementById('wizardPreset'),
      wizardTestsRoot: document.getElementById('wizardTestsRoot'),
      wizardPracticalName: document.getElementById('wizardPracticalName'),
      wizardCourseCode: document.getElementById('wizardCourseCode'),
      wizardSrcDir: document.getElementById('wizardSrcDir'),
      wizardCompileCommand: document.getElementById('wizardCompileCommand'),
      wizardRunCommand: document.getElementById('wizardRunCommand'),
      wizardIncludeCheckStyle: document.getElementById('wizardIncludeCheckStyle'),

      wizardSuitePreset: document.getElementById('wizardSuitePreset'),
      wizardSuiteNames: document.getElementById('wizardSuiteNames'),
      wizardPreview: document.getElementById('wizardPreview'),

      btnWizardCancel: document.getElementById('btnWizardCancel'),
      btnWizardBack: document.getElementById('btnWizardBack'),
      btnWizardNext: document.getElementById('btnWizardNext'),
      btnWizardCreate: document.getElementById('btnWizardCreate'),
    };

    let state = {
      rootDir: undefined,
      suites: [],
      selectedSuiteDir: undefined,
      targetDir: undefined,
      teacherMode: false,
      recording: false,
      results: []
    };

    let wizardOpen = false;
    let wizardStep = 1;

    function defaultTestsRoot() {
      if (state.rootDir) return state.rootDir;
      return 'Tests';
    }

    function applyPreset(preset) {
      if (preset === 'java-basic') {
        els.wizardPracticalName.value = 'Practical 1';
        els.wizardCourseCode.value = 'CS1003';
        els.wizardSrcDir.value = 'src';
        els.wizardCompileCommand.value = 'javac *.java';
        els.wizardRunCommand.value = 'java Main';
        els.wizardIncludeCheckStyle.value = 'false';
        els.wizardSuitePreset.value = 'single';
        els.wizardSuiteNames.value = 'basic';
      } else if (preset === 'java-checkstyle') {
        els.wizardPracticalName.value = 'Practical 1';
        els.wizardCourseCode.value = 'CS1003';
        els.wizardSrcDir.value = 'src';
        els.wizardCompileCommand.value = 'javac *.java';
        els.wizardRunCommand.value = 'java Main';
        els.wizardIncludeCheckStyle.value = 'true';
        els.wizardSuitePreset.value = 'single';
        els.wizardSuiteNames.value = 'basic';
      } else if (preset === 'python-basic') {
        els.wizardPracticalName.value = 'Practical 1';
        els.wizardCourseCode.value = 'CS1003';
        els.wizardSrcDir.value = 'src';
        els.wizardCompileCommand.value = 'python3 -m py_compile *.py';
        els.wizardRunCommand.value = 'python3 main.py';
        els.wizardIncludeCheckStyle.value = 'false';
        els.wizardSuitePreset.value = 'single';
        els.wizardSuiteNames.value = 'basic';
      } else if (preset === 'c-basic') {
        els.wizardPracticalName.value = 'Practical 1';
        els.wizardCourseCode.value = 'CS1003';
        els.wizardSrcDir.value = 'src';
        els.wizardCompileCommand.value = 'gcc -Wall -Wextra -o program *.c';
        els.wizardRunCommand.value = './program';
        els.wizardIncludeCheckStyle.value = 'false';
        els.wizardSuitePreset.value = 'single';
        els.wizardSuiteNames.value = 'basic';
      }
      updateSuiteNamesFromPreset();
      renderWizard();
    }

    function updateSuiteNamesFromPreset() {
      const preset = els.wizardSuitePreset.value;
      if (preset === 'single') {
        els.wizardSuiteNames.value = 'basic';
      } else if (preset === 'options') {
        els.wizardSuiteNames.value = 'option1/words, option1/names';
      }
      updateWizardPreview();
    }

    function parseSuiteNames(raw) {
      return String(raw || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);
    }

    function suiteMetaText(s) {
      const parts = [];
      parts.push(\`\${s.inputCount} in\`);
      if (s.outputCount > 0) parts.push(\`\${s.outputCount} out\`);
      const scripts = [];
      if (s.hasProgRun) scripts.push('prog-run.sh');
      if (s.hasBuildAll) scripts.push('build-all.sh');
      if (s.testShCount > 0) scripts.push(\`test-*.sh×\${s.testShCount}\`);
      if (scripts.length) parts.push(scripts.join(', '));
      return parts.join(' • ');
    }

    function computeReady() {
      if (!state.rootDir) return false;
      if (!state.suites || state.suites.length === 0) return true;
      return !!state.selectedSuiteDir;
    }

    function computePassFail(results) {
      const tests = (results || []).filter(r => r.kind === 'test');
      const total = tests.length;
      const pass = tests.filter(t => t.outcome === 'pass').length;
      return { pass, total, pct: total ? Math.round((pass / total) * 100) : 0 };
    }

    function renderResults() {
      const { pass, total, pct } = computePassFail(state.results);

      if (!total) {
        els.textSummary.textContent = 'No results yet.';
        els.pillPassFail.textContent = '—';
        els.progressFill.style.width = '0%';
        els.resultsList.innerHTML = '';
        return;
      }

      els.textSummary.textContent = \`\${pass} / \${total} tests passed\`;
      els.pillPassFail.textContent = \`\${pct}%\`;
      els.progressFill.style.width = \`\${pct}%\`;

      const items = [];
      for (const r of state.results) {
        if (r.kind === 'summary') {
          items.push(\`<div class="muted" style="margin-top:8px;">\${escapeHtml((r.details && r.details[0]) || '')}</div>\`);
          continue;
        }

        const label = \`\${r.type} — \${r.name}\`;
        const badgeClass = r.outcome === 'pass' ? 'pass' : 'fail';
        const badgeText = r.outcome.toUpperCase();
        const detailsText = (r.details || []).join('\\n').trim();

        items.push(\`
          <div class="test">
            <details>
              <summary class="testHeader">
                <span>\${escapeHtml(label)}</span>
                <span class="badge \${badgeClass}">\${badgeText}</span>
              </summary>
              <pre>\${escapeHtml(detailsText)}</pre>
            </details>
          </div>
        \`);
      }

      els.resultsList.innerHTML = items.join('');
    }

    function updateWizardPreview() {
      const root = (els.wizardTestsRoot.value || defaultTestsRoot()).trim();
      const practicalName = (els.wizardPracticalName.value || 'Practical 1').trim();
      const courseCode = (els.wizardCourseCode.value || 'CS1003').trim();
      const srcDir = (els.wizardSrcDir.value || 'src').trim();
      const suiteNames = parseSuiteNames(els.wizardSuiteNames.value);
      const includeCheckStyle = els.wizardIncludeCheckStyle.value === 'true';

      const lines = [];
      lines.push(root + '/');
      lines.push('  practical.config');
      lines.push('');
      lines.push('  practical.config contents:');
      lines.push('    [info]');
      lines.push(\`    practical = \${practicalName}\`);
      lines.push(\`    course = \${courseCode}\`);
      lines.push(\`    srcdir = \${srcDir}\`);
      lines.push('');

      for (const suite of suiteNames) {
        lines.push(\`  \${suite}/\`);
        lines.push('    build-all.sh');
        lines.push('    prog-run.sh');
      }

      if (includeCheckStyle) {
        lines.push('');
        lines.push('  CheckStyle/');
        lines.push('    build-all.sh');
        lines.push('    test-CheckStyle.sh');
        lines.push('    cs1002_checks.xml');
        lines.push('  libs/');
        lines.push('    README.txt');
      }

      els.wizardPreview.textContent = lines.join('\\n');
    }

    function openWizard() {
      wizardOpen = true;
      wizardStep = 1;
      els.wizardCard.classList.remove('wizardHidden');

      els.wizardTestsRoot.value = defaultTestsRoot();
      applyPreset(els.wizardPreset.value);
      renderWizard();
    }

    function closeWizard() {
      wizardOpen = false;
      wizardStep = 1;
      els.wizardCard.classList.add('wizardHidden');
      renderWizard();
    }

    function renderWizard() {
      const steps = [els.stepPill1, els.stepPill2, els.stepPill3, els.stepPill4];
      const pages = [els.wizardStep1, els.wizardStep2, els.wizardStep3, els.wizardStep4];

      steps.forEach((el, idx) => el.classList.toggle('active', idx + 1 === wizardStep));
      pages.forEach((el, idx) => el.classList.toggle('wizardHidden', idx + 1 !== wizardStep));

      els.btnWizardBack.disabled = wizardStep === 1;
      els.btnWizardNext.classList.toggle('wizardHidden', wizardStep === 4);
      els.btnWizardCreate.classList.toggle('wizardHidden', wizardStep !== 4);

      updateWizardPreview();
    }

    function nextWizardStep() {
      if (wizardStep < 4) {
        wizardStep += 1;
        renderWizard();
      }
    }

    function backWizardStep() {
      if (wizardStep > 1) {
        wizardStep -= 1;
        renderWizard();
      }
    }

    function submitWizard() {
      const payload = {
        testsRoot: els.wizardTestsRoot.value.trim(),
        practicalName: els.wizardPracticalName.value.trim(),
        courseCode: els.wizardCourseCode.value.trim(),
        srcDir: els.wizardSrcDir.value.trim(),
        compileCommand: els.wizardCompileCommand.value.trim(),
        runCommand: els.wizardRunCommand.value.trim(),
        suiteNamesRaw: els.wizardSuiteNames.value.trim(),
        includeCheckStyle: els.wizardIncludeCheckStyle.value === 'true'
      };

      vscode.postMessage({ type: 'submitWizard', payload });
      closeWizard();
    }

    function render() {
      if (state.rootDir) {
        els.textRootDir.textContent = state.rootDir;
        els.pillReady.textContent = computeReady() ? 'Ready' : 'Pick suite';
      } else {
        els.textRootDir.textContent = 'No directory selected.';
        els.pillReady.textContent = 'No folder';
      }

      els.suiteSelect.innerHTML = '';
      if (state.suites && state.suites.length > 0) {
        els.suiteSelect.disabled = false;

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a suite…';
        els.suiteSelect.appendChild(placeholder);

        for (const s of state.suites) {
          const opt = document.createElement('option');
          opt.value = s.absPath;
          opt.textContent = \`\${s.label}  —  \${suiteMetaText(s)}\`;
          if (state.selectedSuiteDir === s.absPath) opt.selected = true;
          els.suiteSelect.appendChild(opt);
        }

        const selected = state.suites.find(x => x.absPath === state.selectedSuiteDir);
        els.textSuiteMeta.textContent = selected ? suiteMetaText(selected) : '';
      } else {
        els.suiteSelect.disabled = true;
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No suites detected';
        els.suiteSelect.appendChild(opt);
        els.textSuiteMeta.textContent = '';
      }

      const ready = computeReady();
      els.btnRun.disabled = !ready;
      els.btnAdd.disabled = !ready;

      els.btnTeacherMode.textContent = state.teacherMode ? 'Exit' : 'Enter';
      els.btnWizard.disabled = !state.teacherMode;
      els.btnRecord.disabled = !ready || !state.teacherMode;
      els.btnRecord.textContent = state.recording ? 'Stop Recording' : 'Record Tests';
      els.textRecordHint.textContent = state.teacherMode
        ? (state.recording ? 'Recorder terminal is active.' : 'Use the wizard to scaffold suites, or record tests into the selected suite.')
        : 'Enable Teacher Mode to use the setup wizard and recording tools.';

      if (!state.teacherMode && wizardOpen) {
        closeWizard();
      }

      renderResults();
    }

    els.btnSelectDir.addEventListener('click', () => vscode.postMessage({ type: 'selectDirectory' }));
    els.btnRun.addEventListener('click', () => vscode.postMessage({ type: 'runTests' }));
    els.btnAdd.addEventListener('click', () => vscode.postMessage({ type: 'addTest' }));
    els.btnWizard.addEventListener('click', openWizard);

    els.btnTeacherMode.addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleTeacherMode', on: !state.teacherMode });
    });

    els.btnRecord.addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleRecording', on: !state.recording });
    });

    els.suiteSelect.addEventListener('change', () => {
      const suitePath = els.suiteSelect.value;
      if (suitePath) vscode.postMessage({ type: 'setSuite', suitePath });
    });

    els.wizardPreset.addEventListener('change', () => applyPreset(els.wizardPreset.value));
    els.wizardSuitePreset.addEventListener('change', updateSuiteNamesFromPreset);

    [
      els.wizardTestsRoot,
      els.wizardPracticalName,
      els.wizardCourseCode,
      els.wizardSrcDir,
      els.wizardCompileCommand,
      els.wizardRunCommand,
      els.wizardIncludeCheckStyle,
      els.wizardSuiteNames
    ].forEach(el => el.addEventListener('input', updateWizardPreview));

    els.btnWizardCancel.addEventListener('click', closeWizard);
    els.btnWizardBack.addEventListener('click', backWizardStep);
    els.btnWizardNext.addEventListener('click', nextWizardStep);
    els.btnWizardCreate.addEventListener('click', submitWizard);

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg?.type === 'state') {
        state = msg.state;
        render();
      }
    });

    vscode.postMessage({ type: 'requestState' });

    function escapeHtml(str) {
      return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}