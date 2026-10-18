import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import type {
  PtyRunnerOptions,
  DataListener,
  ExitListener,
  SpawnConfig,
} from './types.js';

// Resolve spawn helper handling both ESM namespace and CJS default exports
const spawnPty: typeof nodePty.spawn =
  (nodePty as unknown as { spawn?: typeof nodePty.spawn }).spawn ??
  (nodePty as unknown as { default?: { spawn?: typeof nodePty.spawn } }).default?.spawn!;

/**
 * PtyRunner manages cross-platform pseudoterminal execution for Antigravity agents.
 * Spawns child processes via node-pty using ConPTY on Windows or standard POSIX PTY on Unix.
 */
export class PtyRunner {
  private options: PtyRunnerOptions;
  private dataListeners: DataListener[] = [];
  private exitListeners: ExitListener[] = [];
  private ptyProcess: IPty | null = null;
  private isRunning: boolean = false;

  constructor(options: PtyRunnerOptions) {
    this.options = {
      cols: 80,
      rows: 30,
      dryRun: false,
      ...options,
    };
  }

  /**
   * Returns a copy of the current configuration options.
   */
  getOptions(): Readonly<PtyRunnerOptions> {
    return { ...this.options };
  }

  /**
   * Subscribes a listener to receive raw output stream chunks from the PTY.
   */
  onData(callback: DataListener): void {
    this.dataListeners.push(callback);
  }

  /**
   * Subscribes a listener to receive the exit code and optional signal upon process exit.
   */
  onExit(callback: ExitListener): void {
    this.exitListeners.push(callback);
  }

  /**
   * Resolves command, arguments, and terminal fork options according to platform.
   */
  resolveSpawnConfig(platform: NodeJS.Platform = process.platform): SpawnConfig {
    const isWindows = platform === 'win32';
    const defaultShell = isWindows
      ? (process.env.COMSPEC || 'cmd.exe')
      : (process.env.SHELL || '/bin/sh');

    const file =
      this.options.binaryPath && this.options.binaryPath.trim().length > 0
        ? this.options.binaryPath
        : defaultShell;

    const args: string[] = [];
    if (this.options.agent && this.options.agent.trim().length > 0) {
      args.push('--agent', this.options.agent);
    }
    if (this.options.args && this.options.args.length > 0) {
      args.push(...this.options.args);
    }

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }

    const ptyOptions: SpawnConfig['options'] = {
      name: 'xterm-color',
      cols: this.options.cols ?? 80,
      rows: this.options.rows ?? 30,
      cwd: this.options.projectDir,
      env,
    };

    if (isWindows) {
      ptyOptions.useConpty = true;
    }

    return {
      file,
      args,
      options: ptyOptions,
    };
  }

  /**
   * Spawns child process via node-pty, or simulates execution in dry-run mode.
   * Returns a Promise resolving to the process exit code.
   */
  async start(): Promise<number> {
    if (this.isRunning) {
      throw new Error('PtyRunner instance is already running.');
    }

    if (this.options.dryRun) {
      this.isRunning = true;
      const config = this.resolveSpawnConfig();
      const simulatedOutput = [
        `[DRY-RUN] Initializing simulated PTY agent '${this.options.agent}'\r\n`,
        `[DRY-RUN] Target Project: ${this.options.projectDir}\r\n`,
        `[DRY-RUN] Command: ${config.file} ${config.args.join(' ')}\r\n`,
        `[DRY-RUN] Simulating PTY session execution...\r\n`,
        `[DRY-RUN] Execution completed successfully.\r\n`,
      ];

      for (const chunk of simulatedOutput) {
        this.emitData(chunk);
      }

      this.isRunning = false;
      this.emitExit(0, undefined);
      return 0;
    }

    return new Promise<number>((resolve, reject) => {
      try {
        const config = this.resolveSpawnConfig();
        this.ptyProcess = spawnPty(config.file, config.args, config.options);
        this.isRunning = true;

        this.ptyProcess.onData((data: string) => {
          this.emitData(data);
        });

        this.ptyProcess.onExit(({ exitCode, signal }) => {
          this.isRunning = false;
          this.ptyProcess = null;
          this.emitExit(exitCode, signal);
          resolve(exitCode);
        });
      } catch (err: unknown) {
        this.isRunning = false;
        this.ptyProcess = null;

        const isWin = process.platform === 'win32';
        const errorMessage = err instanceof Error ? err.message : String(err);
        const formattedError = new Error(
          isWin
            ? `Failed to spawn PTY with ConPTY on Windows: ${errorMessage}. Ensure Windows 10/11 (build >= 18309) or install Visual Studio C++ runtime and build tools.`
            : `Failed to spawn PTY: ${errorMessage}.`
        );
        if (err instanceof Error && err.stack) {
          formattedError.stack = `${formattedError.stack}\nCaused by: ${err.stack}`;
        }
        reject(formattedError);
      }
    });
  }

  /**
   * Writes characters/keystrokes directly to the pseudoterminal's stdin.
   */
  write(input: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(input);
    }
  }

  /**
   * Resizes the dimensions of the pseudoterminal.
   */
  resize(cols: number, rows: number): void {
    this.options.cols = cols;
    this.options.rows = rows;
    if (this.ptyProcess) {
      this.ptyProcess.resize(cols, rows);
    }
  }

  /**
   * Cleanly terminates the active PTY session.
   */
  kill(signal?: string): void {
    if (this.ptyProcess) {
      try {
        if (process.platform === 'win32') {
          // Windows node-pty does not support POSIX signals and throws if one is passed
          this.ptyProcess.kill();
        } else {
          this.ptyProcess.kill(signal);
        }
      } catch {
        // Safe to ignore if process already terminated
      }
      this.ptyProcess = null;
      this.isRunning = false;
    }
  }

  private emitData(data: string): void {
    for (const listener of this.dataListeners) {
      try {
        listener(data);
      } catch (err) {
        console.error('Error in PtyRunner onData listener:', err);
      }
    }
  }

  private emitExit(code: number, signal?: number): void {
    for (const listener of this.exitListeners) {
      try {
        listener(code, signal);
      } catch (err) {
        console.error('Error in PtyRunner onExit listener:', err);
      }
    }
  }
}
