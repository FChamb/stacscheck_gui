// parser.ts
// Converts stacscheck stdout text into a structured shape.

import { Parsed, TestResult, TestCaseResult, SummaryResult, TestOutcome } from './types';

/**
 * stacscheck output (typical) looks like:
 *  * <type> - <name> : pass
 *  * <type> - <name> : fail
 *  ... extra diagnostic lines for the failing test ...
 *  7 out of 10 tests passed
 *
 * This parser is intentionally tolerant: it will keep raw lines even if it can't
 * perfectly match a pattern.
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
      current.details.push(line);
    } else {
      header.push(line);
    }
  }

  return { header, tests };
}

/**
 * Matches lines like:
 *   * IO - factorial_zero : pass
 *   * CheckStyle - audit : fail
 */
function parseTestHeaderLine(line: string): { type: string; name: string; outcome: TestOutcome } | undefined {
  // Allow flexible spaces and tolerate extra text around separators.
  // Groups: type, name, outcome
  const m = line.match(/^\*\s+(.*?)\s*-\s*(.*?)\s*:\s*(pass|fail)\s*$/i);
  if (!m) return undefined;

  const type = m[1].trim();
  const name = m[2].trim();
  const outcome = m[3].toLowerCase() as TestOutcome;

  if (!type || !name) return undefined;
  return { type, name, outcome };
}

function parseSummaryLine(line: string): boolean {
  // Tolerate optional punctuation at end.
  return /^\d+\s+out\s+of\s+\d+\s+tests\s+passed\b/i.test(line.trim());
}