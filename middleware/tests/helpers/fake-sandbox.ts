type FileContent = Buffer | string;

interface FakeCommandConfig {
  exitCode: number | null;
  stdout?: string;
  stderr?: string;
}

class FakeCommand {
  exitCode: number | null;
  private readonly stdoutText: string;
  private readonly stderrText: string;

  constructor(config: FakeCommandConfig) {
    this.exitCode = config.exitCode;
    this.stdoutText = config.stdout ?? "";
    this.stderrText = config.stderr ?? "";
  }

  async stdout(): Promise<string> {
    return this.stdoutText;
  }

  async stderr(): Promise<string> {
    return this.stderrText;
  }
}

type RunCommandInput =
  | string
  | {
      cmd: string;
      args?: string[];
    };

export class FakeSandbox {
  private readonly files = new Map<string, Buffer>();
  private readonly commands = new Map<string, FakeCommand>();
  readonly commandLog: Array<{ cmd: string; args: string[] }> = [];

  async writeFiles(
    entries: Array<{ path: string; content: FileContent }>
  ): Promise<void> {
    for (const entry of entries) {
      this.files.set(
        entry.path,
        Buffer.isBuffer(entry.content)
          ? Buffer.from(entry.content)
          : Buffer.from(entry.content)
      );
    }
  }

  async readFileToBuffer({
    path,
  }: {
    path: string;
  }): Promise<Buffer | null> {
    const value = this.files.get(path);
    if (!value) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return Buffer.from(value);
  }

  async getCommand(cmdId: string): Promise<FakeCommand> {
    const command = this.commands.get(cmdId);
    if (!command) {
      throw new Error(`Command not found: ${cmdId}`);
    }
    return command;
  }

  async runCommand(
    input: RunCommandInput,
    args: string[] = []
  ): Promise<FakeCommand> {
    if (typeof input === "string") {
      this.commandLog.push({ cmd: input, args });
    } else {
      this.commandLog.push({ cmd: input.cmd, args: input.args ?? [] });
      if (input.cmd === "bash" && input.args?.[0] === "-lc") {
        const script = input.args[1] ?? "";
        const cleanupPrefix = "rm -f -- ";
        if (script.startsWith(cleanupPrefix)) {
          const paths = script
            .slice(cleanupPrefix.length)
            .split(/\s+/)
            .filter(Boolean);
          for (const path of paths) {
            this.files.delete(path);
          }
        }
      }
    }

    return new FakeCommand({ exitCode: 0 });
  }

  domain(port: number): string {
    return `https://preview.example.test:${port}`;
  }

  setFile(path: string, content: FileContent): void {
    this.files.set(
      path,
      Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content)
    );
  }

  setCommand(cmdId: string, config: FakeCommandConfig): void {
    this.commands.set(cmdId, new FakeCommand(config));
  }
}
