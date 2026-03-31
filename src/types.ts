/**
 * Shared result types used across the extension.
 *
 * These types intentionally reflect the parser output rather than the full internal
 * behaviour of stacscheck. The GUI only needs enough structure to:
 * - identify tests
 * - show pass/fail state
 * - display associated detail lines
 * - show a summary row
 */

export type TestOutcome = 'pass' | 'fail';

export interface TestCaseResult {
  kind: 'test';

  /**
   * Category reported by stacscheck, for example:
   * - IO
   * - CheckStyle
   * - Script
   */
  type: string;

  /**
   * Human readable test name reported by stacscheck.
   */
  name: string;

  outcome: TestOutcome;

  /**
   * Raw lines associated with this test block, including the original header line.
   * Keeping the raw lines makes the GUI tolerant of variations in failure messages.
   */
  details: string[];
}

export interface SummaryResult {
  kind: 'summary';

  /**
   * Raw summary line(s), usually something like:
   * "7 out of 10 tests passed"
   */
  details: string[];
}

export type TestResult = TestCaseResult | SummaryResult;

export interface Parsed {
  /**
   * Lines printed before the first test is reported.
   * These are preserved for completeness even if they are not always shown prominently.
   */
  header: string[];

  /**
   * Parsed tests and summary lines in their original order.
   */
  tests: TestResult[];
}