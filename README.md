# antigravity-master-supervisor

Master Supervisor CLI tool (`agy-supervisor` / `agysup`) for Antigravity AI agent orchestration.

## Overview

`antigravity-master-supervisor` provides cross-platform PTY orchestration and workspace lifecycle state management for autonomous Antigravity AI coding agents. It features:
- Zero Python dependencies (100% native Node.js / TypeScript).
- Persistent state tracking via `.agy/supervisor_state.json`.
- Automatic environment discovery and preflight diagnostics (`doctor` command).
- Terminal PTY process runner (`run` command) with signal handling and graceful cleanup.

## Installation

### From npm Registry

```bash
# Global CLI installation
npm install -g @arcader1500/antigravity-master-supervisor

# Local project installation
npm install @arcader1500/antigravity-master-supervisor
```

### From GitHub Packages

```bash
# Configure npm to use GitHub Packages for the @arcader1500 scope:
# npm config set @arcader1500:registry https://npm.pkg.github.com
npm install -g @arcader1500/antigravity-master-supervisor
```

## CLI Usage

The CLI is available as `agy-supervisor` or `agysup`.

```bash
# Run environment preflight checks and diagnostics
agy-supervisor doctor [projectDir]

# Run supervisor PTY orchestration
agy-supervisor run [projectDir]
```

### Options

- `-v, --version`: Display the version number.
- `-h, --help`: Display help for commands and options.

## Development

```bash
# Install dependencies
npm install

# Build distribution bundles (ESM + types)
npm run build

# Run unit and integration tests
npm test

# Run build watcher during development
npm run dev
```
