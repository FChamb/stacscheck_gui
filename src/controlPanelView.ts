// controlPanelView.ts
// Webview-based control panel for stacscheck GUI.
// Provides a clean layout (sections + bottom pinned Teacher Mode toggle)
// and sends messages to the extension to run commands.
//
// The TreeView remains focused on Suites + Results (hierarchy).

import * as vscode from 'vscode';
import { StacscheckTreeProvider, SuiteInfo } from './treeProvider';

type ControlState = {
  rootDir?: string;
  suites: SuiteInfo[];
  selectedSuiteDir?: string;
  targetDir?: string;
  teacherMode: boolean;
  recording: boolean;
};

export class ControlPanelViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'stacscheckControl';

  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: StacscheckTreeProvider
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Receive events from the webview
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

          case 'requestState':
            this.postState();
            break;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Control panel error: ${message}`);
      }
    });

    // Push initial state
    this.postState();
  }

  /** Call this whenever extension state changes */
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
      recording: this.provider.isRecording()
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             img-src ${webview.cspSource} https:;
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>stacscheck Control Panel</title>

  <style>
    :root {
      --pad: 12px;
      --gap: 10px;
      --radius: 10px;
      --muted: var(--vscode-descriptionForeground);
      --border: color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
      --bg: var(--vscode-sideBar-background);
      --card: color-mix(in srgb, var(--vscode-editorWidget-background) 75%, transparent);
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

    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .muted {
      color: var(--muted);
      font-size: 0.9em;
    }

    button, select {
      font: inherit;
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
    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    select {
      width: 100%;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
    }

    .divider {
      height: 1px;
      background: var(--border);
      margin: 6px 0;
    }

    .spacer {
      flex: 1;
    }

    /* Bottom pinned bar */
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
        Use the recorder terminal to generate many tests quickly.
      </div>
      <div class="row">
        <button id="btnRecord" class="secondary" disabled>Record Tests</button>
        <span class="muted" id="textRecordHint"></span>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="bottomBar">
      <div class="card">
        <div class="toggle">
          <div>
            <div class="title" style="margin: 0;">Teacher Mode</div>
            <div class="muted">Shows recording tools and assumes current solution is correct.</div>
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
      btnRecord: document.getElementById('btnRecord'),
      textRecordHint: document.getElementById('textRecordHint'),

      btnTeacherMode: document.getElementById('btnTeacherMode'),
    };

    let state = {
      rootDir: undefined,
      suites: [],
      selectedSuiteDir: undefined,
      targetDir: undefined,
      teacherMode: false,
      recording: false
    };

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
      if (state.suites.length === 0) return true; // fallback to root
      return !!state.selectedSuiteDir;
    }

    function render() {
      // Setup block
      if (state.rootDir) {
        els.textRootDir.textContent = state.rootDir;
        els.pillReady.textContent = computeReady() ? 'Ready' : 'Pick suite';
      } else {
        els.textRootDir.textContent = 'No directory selected.';
        els.pillReady.textContent = 'No folder';
      }

      // Suites
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

      // Actions enabled/disabled
      const ready = computeReady();
      els.btnRun.disabled = !ready;
      els.btnAdd.disabled = !ready;

      // Teacher UI
      els.btnTeacherMode.textContent = state.teacherMode ? 'Exit' : 'Enter';
      els.btnRecord.disabled = !ready || !state.teacherMode;
      els.btnRecord.textContent = state.recording ? 'Stop Recording' : 'Record Tests';
      els.textRecordHint.textContent = state.teacherMode
        ? (state.recording ? 'Recorder terminal is active.' : 'Opens recorder terminal.')
        : 'Enable Teacher Mode to record.';

      // Style nuance
      els.btnTeacherMode.classList.toggle('secondary', true);
      els.btnRecord.classList.toggle('secondary', !state.recording);
    }

    // UI events
    els.btnSelectDir.addEventListener('click', () => vscode.postMessage({ type: 'selectDirectory' }));
    els.btnRun.addEventListener('click', () => vscode.postMessage({ type: 'runTests' }));
    els.btnAdd.addEventListener('click', () => vscode.postMessage({ type: 'addTest' }));

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

    // Receive state updates
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg?.type === 'state') {
        state = msg.state;
        render();
      }
    });

    // Ask for initial state (in case extension posts before listener attaches)
    vscode.postMessage({ type: 'requestState' });
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