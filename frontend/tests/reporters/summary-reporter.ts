import type {
  FullResult,
  Reporter,
  TestCase,
  TestError,
  TestResult,
} from "@playwright/test/reporter"

interface Outcome {
  test: TestCase
  result: TestResult
}

function firstLine(text?: string): string | undefined {
  const line = text?.trim().split(/\r?\n/)[0]?.trim()
  return line || undefined
}

class SummaryReporter implements Reporter {
  private outcomes = new Map<string, Outcome>()
  private errors: TestError[] = []

  onTestEnd(test: TestCase, result: TestResult) {
    // Keep only the final attempt so retried tests are counted once.
    this.outcomes.set(test.id, { test, result })
  }

  onError(error: TestError) {
    this.errors.push(error)
  }

  onEnd(result: FullResult) {
    let passed = 0
    const failures: string[] = []

    for (const { test, result } of this.outcomes.values()) {
      if (result.status === "passed") {
        passed++
        continue
      }
      if (result.status === "skipped") {
        continue
      }

      const file = test.location.file.replace(`${process.cwd()}/`, "")
      const location = `${file}:${test.location.line}`
      const message =
        firstLine(result.error?.message) ?? firstLine(result.error?.value) ?? result.status
      failures.push(`${location} › ${test.titlePath().join(" › ")} — ${message}`)
    }

    for (const error of this.errors) {
      const message = firstLine(error.message) ?? firstLine(error.value) ?? "unknown error"
      failures.push(`global error — ${message}`)
    }

    if (failures.length === 0 && result.status !== "passed") {
      failures.push(`test run ${result.status}`)
    }

    console.log(`${passed} passed`)
    if (failures.length === 0) {
      console.log("0 failed")
      return
    }

    console.log(`${failures.length} failed:`)
    for (const failure of failures) {
      console.log(`  - ${failure}`)
    }
  }
}

export default SummaryReporter
