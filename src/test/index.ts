/**
 * Test entry point — runs all test suites.
 * Run: node out/test/index.js
 */
import { finalSummary } from './test-runner';

console.log('\n  MiMo Agent Test Suite\n  =====================');

require('./test-context');
require('./test-api-endpoint');
require('./test-mcp-multimodal-server');
require('./test-markdown');
require('./test-personas');
require('./test-safety');
require('./test-tools');
require('./test-instructions');
require('./test-dependency-install');
require('./test-agent-errors');
require('./test-agent-convergence');
require('./test-router');
require('./test-webview-chat-bubble');
require('./test-plan-mode');

console.log('\n  All tests completed.');
finalSummary();
