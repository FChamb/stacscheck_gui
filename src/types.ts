export interface TestResult {
  type: string;
  name?: string;       // test name from stacscheck
  result?: string;     // "pass" | "fail"
  details: string[];
}

export interface Parsed {
  header: string[];
  tests: TestResult[];
}
