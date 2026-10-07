import * as fs from 'fs';
import * as path from 'path';
import { PolicyEngine } from '../security/policyEngine.js';

export interface FileInspectResult {
  exists: boolean;
  isDirectory?: boolean;
  isFile?: boolean;
  isSymlink?: boolean;
  realPath?: string;
  size?: number;
  modifiedTime?: number;
}

export interface SearchFilesOptions {
  cwd?: string;
  recursive?: boolean;
  maxResults?: number;
  includeDirectories?: boolean;
}

export class FilesystemEngine {
  private workspaceRoot: string;
  private policyEngine: PolicyEngine;
  private activeWatchers: Set<fs.FSWatcher> = new Set();

  constructor(workspaceRoot?: string, policyEngine?: PolicyEngine) {
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
    this.policyEngine = policyEngine || PolicyEngine.getInstance();
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = path.resolve(root);
  }

  /**
   * Resolves and verifies a path against workspace boundaries and symlink escapes.
   */
  public verifyPath(targetPath: string, operation: 'read' | 'write' | 'delete'): string {
    const resolved = path.resolve(this.workspaceRoot, targetPath);
    const check = this.policyEngine.evaluateFileAccess(resolved, operation);
    if (!check.allowed) {
      throw new Error(`[FILESYSTEM SECURITY DENIAL] ${check.reason || 'Operation blocked by security policy.'}`);
    }
    return resolved;
  }

  public async readFile(
    filePath: string,
    options?: { encoding?: BufferEncoding; maxBytes?: number }
  ): Promise<{ content: string; truncated: boolean; bytesRead: number }> {
    const verified = this.verifyPath(filePath, 'read');
    const maxBytes = options?.maxBytes || 1024 * 1024; // 1MB default
    const stat = await fs.promises.stat(verified);

    if (stat.size > maxBytes) {
      const handle = await fs.promises.open(verified, 'r');
      try {
        const buffer = Buffer.alloc(maxBytes);
        const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
        return {
          content: buffer.slice(0, bytesRead).toString(options?.encoding || 'utf8'),
          truncated: true,
          bytesRead
        };
      } finally {
        await handle.close();
      }
    }

    const content = await fs.promises.readFile(verified, options?.encoding || 'utf8');
    return {
      content,
      truncated: false,
      bytesRead: stat.size
    };
  }

  public async writeFile(
    filePath: string,
    content: string | Buffer,
    options?: { overwrite?: boolean; createDirs?: boolean }
  ): Promise<{ path: string; bytesWritten: number }> {
    const verified = this.verifyPath(filePath, 'write');

    if (options?.createDirs !== false) {
      await fs.promises.mkdir(path.dirname(verified), { recursive: true });
    }

    if (options?.overwrite === false && fs.existsSync(verified)) {
      throw new Error(`File already exists: "${filePath}". Overwrite is set to false.`);
    }

    await fs.promises.writeFile(verified, content);
    const bytesWritten = typeof content === 'string' ? Buffer.byteLength(content) : content.length;
    return { path: verified, bytesWritten };
  }

  public async editFile(
    filePath: string,
    chunk: { targetContent: string; replacementContent: string }
  ): Promise<{ success: boolean; path: string }> {
    const verified = this.verifyPath(filePath, 'write');
    const existing = await fs.promises.readFile(verified, 'utf8');

    if (!existing.includes(chunk.targetContent)) {
      throw new Error(`Target content to edit not found in "${filePath}".`);
    }

    const updated = existing.replace(chunk.targetContent, chunk.replacementContent);
    await fs.promises.writeFile(verified, updated, 'utf8');
    return { success: true, path: verified };
  }

  public async moveFile(
    srcPath: string,
    dstPath: string,
    options?: { overwrite?: boolean }
  ): Promise<{ src: string; dst: string }> {
    const verifiedSrc = this.verifyPath(srcPath, 'delete');
    const verifiedDst = this.verifyPath(dstPath, 'write');

    if (!options?.overwrite && fs.existsSync(verifiedDst)) {
      throw new Error(`Destination already exists: "${dstPath}". Overwrite is false.`);
    }

    await fs.promises.mkdir(path.dirname(verifiedDst), { recursive: true });
    await fs.promises.rename(verifiedSrc, verifiedDst);
    return { src: verifiedSrc, dst: verifiedDst };
  }

  public async copyFile(
    srcPath: string,
    dstPath: string,
    options?: { overwrite?: boolean }
  ): Promise<{ src: string; dst: string }> {
    const verifiedSrc = this.verifyPath(srcPath, 'read');
    const verifiedDst = this.verifyPath(dstPath, 'write');

    if (!options?.overwrite && fs.existsSync(verifiedDst)) {
      throw new Error(`Destination already exists: "${dstPath}". Overwrite is false.`);
    }

    await fs.promises.mkdir(path.dirname(verifiedDst), { recursive: true });
    await fs.promises.copyFile(verifiedSrc, verifiedDst);
    return { src: verifiedSrc, dst: verifiedDst };
  }

  public async deleteFile(filePath: string, options?: { recursive?: boolean }): Promise<void> {
    const verified = this.verifyPath(filePath, 'delete');
    const stat = await fs.promises.lstat(verified);

    if (stat.isDirectory()) {
      await fs.promises.rm(verified, { recursive: options?.recursive ?? false, force: true });
    } else {
      await fs.promises.unlink(verified);
    }
  }

  public async inspectPath(targetPath: string): Promise<FileInspectResult> {
    try {
      const resolved = path.resolve(this.workspaceRoot, targetPath);
      // Run read check
      const check = this.policyEngine.evaluateFileAccess(resolved, 'read');
      if (!check.allowed) {
        return { exists: false };
      }

      if (!fs.existsSync(resolved)) {
        return { exists: false };
      }

      const lstat = await fs.promises.lstat(resolved);
      let realPath = resolved;
      try {
        realPath = fs.realpathSync(resolved);
      } catch {}

      return {
        exists: true,
        isDirectory: lstat.isDirectory(),
        isFile: lstat.isFile(),
        isSymlink: lstat.isSymbolicLink(),
        realPath,
        size: lstat.size,
        modifiedTime: lstat.mtimeMs
      };
    } catch {
      return { exists: false };
    }
  }

  public async searchFiles(query: string, options?: SearchFilesOptions): Promise<string[]> {
    const startDir = options?.cwd ? this.verifyPath(options.cwd, 'read') : this.workspaceRoot;
    const maxResults = options?.maxResults || 50;
    const recursive = options?.recursive !== false;
    const results: string[] = [];

    const walk = async (currentDir: string): Promise<void> => {
      if (results.length >= maxResults) return;

      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= maxResults) break;
        if (entry.name === '.git' || entry.name === 'node_modules') continue;

        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(this.workspaceRoot, fullPath);

        const matches = entry.name.toLowerCase().includes(query.toLowerCase());
        if (matches && (entry.isFile() || options?.includeDirectories)) {
          results.push(relPath);
        }

        if (entry.isDirectory() && recursive) {
          await walk(fullPath);
        }
      }
    };

    await walk(startDir);
    return results;
  }

  public watchPath(targetPath: string, callback: (event: string, filename: string | null) => void): () => void {
    const verified = this.verifyPath(targetPath, 'read');
    const watcher = fs.watch(verified, { recursive: false }, callback);
    this.activeWatchers.add(watcher);

    return () => {
      watcher.close();
      this.activeWatchers.delete(watcher);
    };
  }

  public closeAllWatchers(): void {
    for (const w of this.activeWatchers) {
      w.close();
    }
    this.activeWatchers.clear();
  }
}
