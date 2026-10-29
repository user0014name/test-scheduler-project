import { runCli } from './cli.js';

// Preserve the runner's status while allowing console output to finish flushing.
process.exitCode = runCli(process.argv.slice(2));
