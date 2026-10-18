#!/usr/bin/env node
import { createCliProgram } from '../dist/cli/index.js';

const program = createCliProgram();
program.parse(process.argv);
