import * as vscode from 'vscode';
import { TestResult } from './types';

/**
 * Summary metadata for one discovered suite directory.
 *
 * A suite is identified heuristically rather than by a single required file,
 * because stacscheck layouts vary between practicals.
 */
export type SuiteInfo = {
  absPath: string;
  label: string;
  inputCount: number;
  outputCount: number;
  hasProgRun: boolean;
  hasBuildAll: boolean;
  testShCount: number;
};

/**
 * Central in memory state store for the extension.
 *
 * Shared source of truth for:
 * - selected test root / suite
 * - parsed test results
 * - teacher mode state
 * - recorder state
 *
 * The webview asks for this state and re-renders whenever `refresh()` fires.
 */
export class StacscheckTreeProvider {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private selectedRootDir: string | undefined;
  private suites: SuiteInfo[] = [];
  private selectedSuiteDir: string | undefined;

  private testResults: TestResult[] = [];

  private teacherMode = false;
  private recording = false;

  /**
   * Optional stdin used by the recorder rerun workflow.
   * This is kept in shared state so the webview and extension backend stay in sync.
   */
  private recorderInput = '';

  /**
   * Human readable status message shown in the control panel.
   */
  private recorderStatus = 'Recording is off.';

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setSelectedRootDirectory(dirPath: string): void {
    this.selectedRootDir = dirPath;
    this.selectedSuiteDir = undefined;
    this.testResults = [];
    this.refresh();
  }

  getSelectedRootDirectory(): string | undefined {
    return this.selectedRootDir;
  }

  /**
   * Replace the current suite list after rescanning a selected test root.
   *
   * If the previously selected suite no longer exists, clear it to avoid stale state.
   */
  setSuites(suites: SuiteInfo[]): void {
    this.suites = suites;
    const stillValid = this.selectedSuiteDir && suites.some(s => s.absPath === this.selectedSuiteDir);
    if (!stillValid) {
      this.selectedSuiteDir = undefined;
    }
    this.refresh();
  }

  getSuites(): SuiteInfo[] {
    return this.suites;
  }

  /**
   * Select one concrete suite inside the current test root.
   * Parsed results are cleared because they belong to the previous suite selection.
   */
  setSelectedSuiteDirectory(dirPath: string | undefined): void {
    this.selectedSuiteDir = dirPath;
    this.testResults = [];
    this.refresh();
  }

  getSelectedSuiteDirectory(): string | undefined {
    return this.selectedSuiteDir;
  }

  /**
   * The active target directory for test operations.
   *
   * If a suite has been selected, use it.
   * Otherwise fall back to the root directory itself.
   */
  getTargetTestDirectory(): string | undefined {
    return this.selectedSuiteDir ?? this.selectedRootDir;
  }

  setTestResults(results: TestResult[]): void {
    this.testResults = results;
    this.refresh();
  }

  getTestResults(): TestResult[] {
    return this.testResults;
  }

  /**
   * Teacher mode exposes extra authoring workflows such as suite scaffolding
   * and recording support.
   *
   * Recording is always disabled when teacher mode is turned off.
   */
  setTeacherMode(on: boolean): void {
    this.teacherMode = on;
    if (!on) {
      this.recording = false;
    }
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

  setRecorderInput(value: string): void {
    this.recorderInput = value;
    this.refresh();
  }

  getRecorderInput(): string {
    return this.recorderInput;
  }

  setRecorderStatus(value: string): void {
    this.recorderStatus = value;
    this.refresh();
  }

  getRecorderStatus(): string {
    return this.recorderStatus;
  }
}