/**
 * Test entry point — runs all test suites.
 * Run: node out/test/index.js
 */
import { finalSummary } from './test-runner';

console.log('\n  MiMo Agent Test Suite\n  =====================');

require('./test-context');
require('./test-markdown');
require('./test-personas');
require('./test-safety');

console.log('\n  All tests completed.');
finalSummary();
