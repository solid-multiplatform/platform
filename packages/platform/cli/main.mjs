#!/usr/bin/env node
// The `solid-platform` executable. Commands and targets live in cli.mjs and
// cli/targets; this file only starts them and sets the exit code.
import { runCli } from './cli.mjs';

const code = await runCli(process.argv.slice(2));
// certify sets a failing code itself; never clear one that is already set.
if (code !== 0) process.exitCode = code;
