#!/usr/bin/env node
import { createCliProgram } from '../dist/cli/index.js';

const program = createCliProgram();
await program.parseAsync(process.argv);
