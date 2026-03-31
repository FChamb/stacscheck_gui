import { Parsed, TestResult, TestCaseResult, SummaryResult, TestOutcome } from './types';

/**
 * Convert raw stacscheck stdout into a structured representation that can be
 * displayed in the GUI.
 *
 * The parser is deliberately tolerant because stacscheck output can vary slightly
 * between practicals and test types. The main assumption is that each reported test
 * begins with a header line of the form:
 *
 *   * <type> - <name> : pass
 *   * <type> - <name> : fail
 *
 * All following lines are attached to that test until either:
 * - another test header is found
 * - a summary line is found
 */
export function parseStacscheckOutput(output: string): Parsed {
  const lines = output.split(/\r?\n/);

  const tests: TestResult[] = [];
  const header: string[] = [];

  let current: TestCaseResult | null = null;

  for (const line of lines) {
    const testHeader = parseTestHeaderLine(line);
    if (testHeader) {
      current = {
        kind: 'test',
        type: testHeader.type,
        name: testHeader.name,
        outcome: testHeader.outcome,
        details: [line]
      };
      tests.push(current);
      continue;
    }

    const summary = parseSummaryLine(line);
    if (summary) {
      const summaryResult: SummaryResult = { kind: 'summary', details: [line] };
      tests.push(summaryResult);
      current = null;
      continue;
    }

    if (current) {
      // Lines after a test header are considered part of that test's details.
      current.details.push(line);
    } else {
      // Lines before the first recognised test are kept as header output.
      header.push(line);
    }
  }

  return { header, tests };
}

/**
 * Match stacscheck test result headers.
 *
 * Example accepted lines:
 *   * IO - factorial_zero : pass
 *   * CheckStyle - audit : fail
 */
function parseTestHeaderLine(line: string): { type: string; name: string; outcome: TestOutcome } | undefined {
  const m = line.match(/^\*\s+(.*?)\s*-\s*(.*?)\s*:\s*(pass|fail)\s*$/i);
  if (!m) return undefined;

  const type = m[1].trim();
  const name = m[2].trim();
  const outcome = m[3].toLowerCase() as TestOutcome;

  if (!type || !name) return undefined;
  return { type, name, outcome };
}

/**
 * Recognise the common summary line:
 *   X out of Y tests passed
 */
function parseSummaryLine(line: string): boolean {
  return /^\d+\s+out\s+of\s+\d+\s+tests\s+passed\b/i.test(line.trim());
}