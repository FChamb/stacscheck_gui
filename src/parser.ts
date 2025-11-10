// Converts stacscheck stdout text into a structured shape.

import { Parsed, TestResult } from './types';

export function parseStacscheckOutput(output: string): Parsed {
  const lines = output.split('\n');
  const tests: TestResult[] = [];
  const header: string[] = [];
  let current: TestResult | null = null;

  for (const line of lines) {
    if (line.startsWith('* ')) {
      const m = line.match(/\* (.*?) - (.*?) : (pass|fail)/);
      if (m) {
        current = { type: m[1], name: m[2], result: m[3], details: [line] };
        tests.push(current);
        continue;
      }
    }

    if (/^\d+ out of \d+ tests passed/.test(line)) {
      tests.push({ type: 'summary', details: [line] });
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
