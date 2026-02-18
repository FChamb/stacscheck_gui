// treeProvider.ts
// State store for the extension (suites, selected suite, teacher mode, recording, results).
// Historically this was also a TreeDataProvider; we keep the event emitter + structure
// so other components can react to changes, but we no longer need to render a tree.

import * as vscode from 'vscode';
import { TestResult } from './types';

export type SuiteInfo = {
  absPath: string;
  label: string;
  inputCount: number;
  outputCount: number;
  hasProgRun: boolean;
  hasBuildAll: boolean;
  testShCount: number;
};

export class StacscheckTreeProvider {
  // We keep the same change event name so existing calls still work.
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private selectedRootDir: string | undefined;
  private suites: SuiteInfo[] = [];
  private selectedSuiteDir: string | undefined;

  private testResults: TestResult[] = [];

  private teacherMode = false;
  private recording = false;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // ---------- Root dir / suites ----------
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

  // ---------- Results ----------
  setTestResults(results: TestResult[]): void {
    this.testResults = results;
    this.refresh();
  }

  getTestResults(): TestResult[] {
    return this.testResults;
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
}