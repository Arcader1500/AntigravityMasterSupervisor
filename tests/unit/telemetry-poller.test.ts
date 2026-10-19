import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { pollWorkspaceOnce, parsePlanTasks } from '../../src/telemetry/poller.js';
import { loadLedger } from '../../src/core/ledger.js';

describe('telemetry/poller', () => {
  describe('parsePlanTasks', () => {
    it('returns empty array for empty markdown or markdown without task headings', () => {
      expect(parsePlanTasks('')).toEqual([]);
      expect(parsePlanTasks('# Just a title\nSome random notes\n')).toEqual([]);
    });

    it('parses tasks and correctly evaluates checkbox statuses', () => {
      const markdown = `
# Implementation Plan

### Task 1: Setup Infrastructure
- [x] Step 1: Install packages
- [x] Step 2: Configure tsconfig

### Task 2: Implement UI Layer
- [x] Step 1: Create layout
- [ ] Step 2: Add buttons
- [ ] Step 3: Connect handlers

### Task 3: Add Documentation
- [ ] Step 1: Write README
- [ ] Step 2: Add API docs

### Task 4: Unchecked Task Without Steps
Just prose description without checkboxes.
`;

      const tasks = parsePlanTasks(markdown);
      expect(tasks).toHaveLength(4);

      expect(tasks[0]).toMatchObject({
        title: 'Task 1: Setup Infrastructure',
        status: 'completed',
      });
      expect(tasks[1]).toMatchObject({
        title: 'Task 2: Implement UI Layer',
        status: 'in_progress',
      });
      expect(tasks[2]).toMatchObject({
        title: 'Task 3: Add Documentation',
        status: 'pending',
      });
      expect(tasks[3]).toMatchObject({
        title: 'Task 4: Unchecked Task Without Steps',
        status: 'pending',
      });
    });

    it('handles uppercase [X] and asterisk * [x] checkboxes', () => {
      const markdown = `
### Task 1: Star Checkboxes
* [X] Step 1
* [x] Step 2
`;
      const tasks = parsePlanTasks(markdown);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('completed');
    });

    it('parses execution waves table, task wave metadata, indices, and step checklists', () => {
      const markdown = `
# Implementation Plan

## Execution Waves

| Wave | Tasks | Description | Files Touched |
|---|---|---|---|
| Wave 1 | Task 1, Task 2 | Foundation | types.ts, poller.ts |
| Wave 2 | Task 3 | Integration | store.ts |

### Task 1: Setup Telemetry Wave Types
- [x] **Step 1: Write the failing test**
- [ ] Step 2: Implement middleware

### Task 2: Implement Parser Events
**Wave:** 1
- [x] Step 1: Add listener
- [x] Step 2: Emit events

### Task 3: Store Forwarding
- [ ] Step 1: Subscribe store
`;

      const tasks = parsePlanTasks(markdown);
      expect(tasks).toHaveLength(3);

      const task1 = tasks[0];
      expect(task1.index).toBe(1);
      expect(task1.wave).toBe(1);
      expect(task1.totalWaves).toBe(2);
      expect(task1.checklist).toEqual([
        { text: 'Write the failing test', checked: true },
        { text: 'Implement middleware', checked: false },
      ]);
      expect(task1.status).toBe('in_progress');

      const task2 = tasks[1];
      expect(task2.index).toBe(2);
      expect(task2.wave).toBe(1);
      expect(task2.totalWaves).toBe(2);
      expect(task2.checklist).toEqual([
        { text: 'Add listener', checked: true },
        { text: 'Emit events', checked: true },
      ]);
      expect(task2.status).toBe('completed');

      const task3 = tasks[2];
      expect(task3.index).toBe(3);
      expect(task3.wave).toBe(2);
      expect(task3.totalWaves).toBe(2);
      expect(task3.checklist).toEqual([
        { text: 'Subscribe store', checked: false },
      ]);
      expect(task3.status).toBe('pending');
    });
  });

  describe('pollWorkspaceOnce', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-poller-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('handles empty workspace with no git and no spec/plan files', () => {
      const snapshot = pollWorkspaceOnce(tmpDir);
      expect(snapshot.specPath).toBeNull();
      expect(snapshot.specContent).toBeNull();
      expect(snapshot.planPath).toBeNull();
      expect(snapshot.planContent).toBeNull();
      expect(snapshot.tasks).toEqual([]);
      expect(snapshot.dirtyFilesCount).toBe(0);
    });

    it('discovers latest spec and plan files and parses task progress', () => {
      const specsDir = path.join(tmpDir, 'docs', 'superpowers', 'specs');
      const plansDir = path.join(tmpDir, 'docs', 'superpowers', 'plans');
      fs.mkdirSync(specsDir, { recursive: true });
      fs.mkdirSync(plansDir, { recursive: true });

      fs.writeFileSync(path.join(specsDir, '2026-10-18-demo-design.md'), '# Demo Spec\nArchitecture description.');
      fs.writeFileSync(
        path.join(plansDir, '2026-10-18-demo-plan.md'),
        '### Task 1: Alpha\n- [x] Step 1\n### Task 2: Beta\n- [ ] Step 1\n'
      );

      const snapshot = pollWorkspaceOnce(tmpDir);
      expect(snapshot.specPath).toContain('2026-10-18-demo-design.md');
      expect(snapshot.specContent).toBe('# Demo Spec\nArchitecture description.');
      expect(snapshot.planPath).toContain('2026-10-18-demo-plan.md');
      expect(snapshot.planContent).toContain('Task 1: Alpha');
      expect(snapshot.tasks).toHaveLength(2);
      expect(snapshot.tasks[0]).toMatchObject({ title: 'Task 1: Alpha', status: 'completed' });
      expect(snapshot.tasks[1]).toMatchObject({ title: 'Task 2: Beta', status: 'pending' });

      // Verifies ledger checkpoints were updated
      const ledger = loadLedger(tmpDir);
      expect(ledger.checkpoints.spec.path).toContain('2026-10-18-demo-design.md');
      expect(ledger.checkpoints.spec.status).toBe('PENDING');
      expect(ledger.checkpoints.plan.path).toContain('2026-10-18-demo-plan.md');
      expect(ledger.checkpoints.plan.status).toBe('PENDING');
    });

    it('selects newest spec and plan when multiple exist', async () => {
      const specsDir = path.join(tmpDir, 'docs', 'plans');
      fs.mkdirSync(specsDir, { recursive: true });

      const oldPlan = path.join(specsDir, '2026-10-17-old-plan.md');
      fs.writeFileSync(oldPlan, '### Task 1: Old\n- [ ] Step 1\n');
      // Set older mtime
      fs.utimesSync(oldPlan, new Date('2026-10-17T00:00:00Z'), new Date('2026-10-17T00:00:00Z'));

      const newPlan = path.join(specsDir, '2026-10-18-new-plan.md');
      fs.writeFileSync(newPlan, '### Task 1: New\n- [x] Step 1\n');
      fs.utimesSync(newPlan, new Date('2026-10-18T12:00:00Z'), new Date('2026-10-18T12:00:00Z'));

      const snapshot = pollWorkspaceOnce(tmpDir);
      expect(snapshot.planPath).toContain('2026-10-18-new-plan.md');
      expect(snapshot.tasks[0]).toMatchObject({ title: 'Task 1: New', status: 'completed' });
    });

    it('extracts git information when inside a git repository', () => {
      execSync('git init -b main', { cwd: tmpDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: tmpDir, stdio: 'ignore' });
      execSync('git config user.name "Tester"', { cwd: tmpDir, stdio: 'ignore' });

      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Initial');
      execSync('git add README.md', { cwd: tmpDir, stdio: 'ignore' });
      execSync('git commit -m "feat: initial commit"', { cwd: tmpDir, stdio: 'ignore' });

      // Add a dirty uncommitted file
      fs.writeFileSync(path.join(tmpDir, 'dirty.txt'), 'dirty content');

      const snapshot = pollWorkspaceOnce(tmpDir);
      expect(snapshot.branch).toBe('main');
      expect(snapshot.dirtyFilesCount).toBe(1);
      expect(snapshot.lastCommit).toBeDefined();
      expect(snapshot.lastCommit?.subject).toBe('feat: initial commit');
      expect(snapshot.lastCommit?.sha).toBeTruthy();
    });
  });
});
