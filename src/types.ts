// types.ts
// Shared types used across the extension.

export type TestOutcome = 'pass' | 'fail';

export interface TestCaseResult {
  kind: 'test';
  /** e.g. "IO", "CheckStyle", "Script", etc. (whatever stacscheck reports) */
  type: string;
  /** Human readable test name from stacscheck output */
  name: string;
  outcome: TestOutcome;
  /** Raw lines associated with this test block (including the header line) */
  details: string[];
}

export interface SummaryResult {
  kind: 'summary';
  /** Raw summary line(s) from stacscheck, usually "X out of Y tests passed ..." */
  details: string[];
}

export type TestResult = TestCaseResult | SummaryResult;

export interface Parsed {
  /** Lines printed before the first test is reported (tool banner, environment, etc.) */
  header: string[];
  /** Test + summary results in the order they appear */
  tests: TestResult[];
}