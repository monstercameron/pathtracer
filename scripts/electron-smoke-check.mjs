import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smokeMainPath = path.join(repoRoot, 'scripts', 'electron-smoke-main.cjs');
const tempDirectory = mkdtempSync(path.join(tmpdir(), 'pathtracer-electron-smoke-'));
const outputPath = path.join(tempDirectory, 'result.json');
const timeoutMilliseconds = 180000;
const verbose = process.argv.includes('--verbose');

const printProcessOutput = (result) => {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
};

try {
  const result = spawnSync(electronPath, [smokeMainPath, '--out', outputPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '0'
    },
    timeout: timeoutMilliseconds
  });

  if (result.error) {
    printProcessOutput(result);
    console.error(`Electron smoke failed to launch: ${result.error.message}`);
    process.exit(1);
  }

  if (!existsSync(outputPath)) {
    printProcessOutput(result);
    console.error('Electron smoke did not write a result file.');
    console.error(`Electron exit status: ${result.status ?? 'null'}, signal: ${result.signal ?? 'null'}`);
    process.exit(result.status || 1);
  }

  const smokeResult = JSON.parse(readFileSync(outputPath, 'utf8'));
  if (verbose || result.status !== 0 || (Array.isArray(smokeResult.failures) && smokeResult.failures.length > 0)) {
    printProcessOutput(result);
  }
  for (const check of smokeResult.checks || []) {
    const detail = check.detail ? `: ${check.detail}` : '';
    console.log(`${check.passed ? 'ok' : 'not ok'} - ${check.name}${detail}`);
  }

  if (Array.isArray(smokeResult.externalRequests) && smokeResult.externalRequests.length > 0) {
    console.error('\nUnexpected external requests:');
    for (const requestUrl of smokeResult.externalRequests) {
      console.error(`- ${requestUrl}`);
    }
  }

  if (Array.isArray(smokeResult.pageErrors) && smokeResult.pageErrors.length > 0) {
    console.error('\nPage errors:');
    for (const pageError of smokeResult.pageErrors) {
      console.error(`- ${pageError.label}: ${pageError.message}`);
    }
  }

  if (
    verbose &&
    Array.isArray(smokeResult.staticServerRequests) &&
    smokeResult.staticServerRequests.length > 0
  ) {
    console.error(`\nLocal browser-smoke requests: ${smokeResult.staticServerRequests.join(', ')}`);
  }

  if (Array.isArray(smokeResult.performanceSummaries) && smokeResult.performanceSummaries.length > 0) {
    for (const summary of smokeResult.performanceSummaries) {
      console.log(
        `perf - ${summary.name}: frames=${summary.frameCount ?? 0}, ` +
        `p95=${Math.round(summary.p95FrameDelta ?? 0)}ms, ` +
        `max=${Math.round(summary.maxFrameDelta ?? 0)}ms`
      );
    }
  }

  if (Array.isArray(smokeResult.failures) && smokeResult.failures.length > 0) {
    console.error('\nElectron smoke failures:');
    for (const failure of smokeResult.failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  console.log(`\n${(smokeResult.checks || []).length} Electron smoke checks passed.`);
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}
