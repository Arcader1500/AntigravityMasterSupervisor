import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { checkGitRepo } from '../core/discovery.js';
import { updateLedger, getLedgerPath } from '../core/ledger.js';
import type { PlanTaskItem, TaskChecklistItem, WorkspacePollSnapshot } from './types.js';

export interface PollWorkspaceOptions {
  syncLedger?: boolean;
}

/**
 * Parses markdown plan content to extract task items, checkbox states, and progress.
 */
export function parsePlanTasks(markdown: string): PlanTaskItem[] {
  if (!markdown || !markdown.trim()) {
    return [];
  }

  const lines = markdown.split(/\r?\n/);
  const tasks: PlanTaskItem[] = [];

  // 1. Scan wave table rows and map task numbers to wave numbers
  const taskWaveMap = new Map<number, number>();
  let maxWaveFound = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const waveRowMatch = trimmed.match(/^\|\s*Wave\s+(\d+)\s*\|\s*([^|]+)\|/i);
    if (waveRowMatch) {
      const waveNum = parseInt(waveRowMatch[1], 10);
      if (waveNum > maxWaveFound) {
        maxWaveFound = waveNum;
      }
      const tasksCell = waveRowMatch[2];
      const taskMatches = tasksCell.matchAll(/Task\s+(\d+)/gi);
      for (const tm of taskMatches) {
        const tNum = parseInt(tm[1], 10);
        taskWaveMap.set(tNum, waveNum);
      }
    }
  }

  let currentTask: {
    id: string;
    index: number;
    title: string;
    checkboxes: boolean[];
    checklist: TaskChecklistItem[];
    wave?: number;
    commitSha?: string;
  } | null = null;

  const finalizeTask = (task: typeof currentTask) => {
    if (!task) {
      return;
    }
    const total = task.checkboxes.length;
    const checked = task.checkboxes.filter(Boolean).length;
    let status: 'pending' | 'in_progress' | 'completed' = 'pending';

    if (total > 0) {
      if (checked === total) {
        status = 'completed';
      } else if (checked > 0) {
        status = 'in_progress';
      } else {
        status = 'pending';
      }
    }

    const assignedWave = task.wave ?? taskWaveMap.get(task.index);
    if (assignedWave !== undefined && assignedWave > maxWaveFound) {
      maxWaveFound = assignedWave;
    }

    tasks.push({
      id: task.id,
      index: task.index,
      title: task.title,
      status,
      ...(task.commitSha ? { commitSha: task.commitSha } : {}),
      ...(assignedWave !== undefined ? { wave: assignedWave } : {}),
      ...(task.checklist.length > 0 ? { checklist: task.checklist } : {}),
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^###\s+(Task\b.*)/i);
    if (headingMatch) {
      finalizeTask(currentTask);
      const rawTitle = headingMatch[1].trim();
      const taskIdMatch = rawTitle.match(/Task\s+(\d+|[a-zA-Z0-9_-]+)/i);
      const parsedNum =
        taskIdMatch && /^\d+$/.test(taskIdMatch[1])
          ? parseInt(taskIdMatch[1], 10)
          : undefined;
      const index = parsedNum ?? (tasks.length + 1);
      const id = taskIdMatch
        ? `task-${taskIdMatch[1].toLowerCase()}`
        : `task-${index}`;

      currentTask = {
        id,
        index,
        title: rawTitle,
        checkboxes: [],
        checklist: [],
      };
      continue;
    }

    if (currentTask) {
      // If a major heading starts, close current task
      if (/^#{1,2}\s+/.test(trimmed)) {
        finalizeTask(currentTask);
        currentTask = null;
        continue;
      }

      // Check for task-level wave metadata: **Wave:** (\d+) or Wave: (\d+)
      const waveMatch = trimmed.match(/^\*{0,2}Wave:\*{0,2}\s*(\d+)/i);
      if (waveMatch) {
        const w = parseInt(waveMatch[1], 10);
        currentTask.wave = w;
        if (w > maxWaveFound) {
          maxWaveFound = w;
        }
      }

      // Check for checkboxes: - [x], - [ ], * [X], etc.
      const checkboxMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s*(.*)$/);
      if (checkboxMatch) {
        const isChecked = checkboxMatch[1].toLowerCase() === 'x';
        currentTask.checkboxes.push(isChecked);
        const rawLabel = checkboxMatch[2] ?? '';
        const cleanText = rawLabel
          .replace(/\*\*/g, '')
          .replace(/^Step\s+\d+:\s*/i, '')
          .trim();
        currentTask.checklist.push({
          text: cleanText,
          checked: isChecked,
        });
      }

      const commitMatch = trimmed.match(/(?:commit|sha)[:\s]+([a-f0-9]{7,40})/i);
      if (commitMatch && !currentTask.commitSha) {
        currentTask.commitSha = commitMatch[1];
      }
    }
  }

  finalizeTask(currentTask);

  if (maxWaveFound > 0) {
    for (const task of tasks) {
      if (task.wave !== undefined) {
        task.totalWaves = maxWaveFound;
      }
    }
  }

  return tasks;
}

interface DiscoveredArtifact {
  relativePath: string;
  fullPath: string;
  content: string;
  mtimeMs: number;
}

/**
 * Searches candidate directories for the newest file matching a given regex.
 */
function findLatestFile(
  projectDir: string,
  relativeDirs: string[],
  filePattern: RegExp
): DiscoveredArtifact | null {
  let latest: DiscoveredArtifact | null = null;

  for (const relDir of relativeDirs) {
    const dirPath = path.resolve(projectDir, relDir);
    if (!fs.existsSync(dirPath)) {
      continue;
    }

    try {
      const dirStat = fs.statSync(dirPath);
      if (!dirStat.isDirectory()) {
        continue;
      }

      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (!filePattern.test(file)) {
          continue;
        }

        const fullPath = path.join(dirPath, file);
        try {
          const fileStat = fs.statSync(fullPath);
          if (fileStat.isFile()) {
            if (!latest || fileStat.mtimeMs > latest.mtimeMs) {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const relativePath = path.relative(projectDir, fullPath).replace(/\\/g, '/');
              latest = {
                relativePath,
                fullPath,
                content,
                mtimeMs: fileStat.mtimeMs,
              };
            }
          }
        } catch {
          // Ignore unreadable files
        }
      }
    } catch {
      // Ignore unreadable directories
    }
  }

  return latest;
}

/**
 * Polls workspace directory for Git status, newest spec, and newest plan artifacts.
 * Automatically syncs discovered paths to .agy/supervisor_state.json when appropriate.
 */
export function pollWorkspaceOnce(
  projectDir: string,
  options?: PollWorkspaceOptions
): WorkspacePollSnapshot {
  const resolvedDir = path.resolve(projectDir);

  // 1. Git branch, dirty file count, and last commit
  let branch = 'unknown';
  let dirtyFilesCount = 0;
  let lastCommit: { sha: string; subject: string } | undefined = undefined;

  const gitResult = checkGitRepo(resolvedDir);
  if (gitResult.isGit) {
    branch = gitResult.branch || 'unknown';

    try {
      const statusRaw = execSync('git status --porcelain', {
        cwd: resolvedDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (statusRaw.length > 0) {
        dirtyFilesCount = statusRaw.split('\n').filter((l) => l.trim().length > 0).length;
      }
    } catch {
      dirtyFilesCount = 0;
    }

    try {
      const logRaw = execSync('git log -1 --format="%h|%s"', {
        cwd: resolvedDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();

      if (logRaw.length > 0) {
        const pipeIdx = logRaw.indexOf('|');
        if (pipeIdx !== -1) {
          lastCommit = {
            sha: logRaw.substring(0, pipeIdx).trim(),
            subject: logRaw.substring(pipeIdx + 1).trim(),
          };
        } else {
          lastCommit = {
            sha: logRaw,
            subject: '',
          };
        }
      }
    } catch {
      lastCommit = undefined;
    }
  }

  // 2. Discover newest spec artifact
  const specCandidateDirs = [
    path.join('docs', 'superpowers', 'specs'),
    path.join('docs', 'plans'),
    path.join('docs', 'specs'),
  ];
  const specPattern = /(?:[-_]design|[-_]spec|^design|^spec)\.md$/i;
  const specArtifact = findLatestFile(resolvedDir, specCandidateDirs, specPattern);

  // 3. Discover newest plan artifact
  const planCandidateDirs = [
    path.join('docs', 'superpowers', 'plans'),
    path.join('docs', 'plans'),
    'docs',
  ];
  const planPattern = /(?:[-_]plan|^plan)\.md$/i;
  const planArtifact = findLatestFile(resolvedDir, planCandidateDirs, planPattern);

  const tasks = planArtifact ? parsePlanTasks(planArtifact.content) : [];

  // 4. Ledger synchronization
  const resolvedCwd = path.resolve(process.cwd());
  const ledgerExists = fs.existsSync(getLedgerPath(resolvedDir));
  const shouldSync =
    options?.syncLedger ?? (resolvedDir !== resolvedCwd || ledgerExists);

  if (shouldSync && (specArtifact || planArtifact || ledgerExists)) {
    try {
      updateLedger(resolvedDir, (ledger) => {
        if (specArtifact) {
          ledger.checkpoints.spec.path = specArtifact.relativePath;
          if (ledger.checkpoints.spec.status === 'UNINITIALIZED') {
            ledger.checkpoints.spec.status = 'PENDING';
          }
        }
        if (planArtifact) {
          ledger.checkpoints.plan.path = planArtifact.relativePath;
          if (ledger.checkpoints.plan.status === 'UNINITIALIZED') {
            ledger.checkpoints.plan.status = 'PENDING';
          }
        }
      });
    } catch {
      // Ignore ledger sync failure during polling
    }
  }

  return {
    branch,
    dirtyFilesCount,
    lastCommit,
    specPath: specArtifact ? specArtifact.relativePath : null,
    specContent: specArtifact ? specArtifact.content : null,
    planPath: planArtifact ? planArtifact.relativePath : null,
    planContent: planArtifact ? planArtifact.content : null,
    tasks,
  };
}
