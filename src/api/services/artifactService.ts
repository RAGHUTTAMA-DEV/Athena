import { ArtifactStore } from '../../storage/stores/types.js';
import * as fs from 'fs';
import * as path from 'path';

export interface LineDiff {
  type: 'added' | 'removed' | 'unchanged';
  line: string;
  lineNumberOld?: number;
  lineNumberNew?: number;
}

export class ArtifactService {
  constructor(private artifactStore: ArtifactStore) {}

  async list(filter?: { type?: any; runId?: string; goalId?: string; limit?: number }) {
    return this.artifactStore.listArtifacts(filter);
  }

  async get(id: string) {
    const art = await this.artifactStore.getArtifact(id);
    if (!art) {
      throw new Error(`Artifact not found: ${id}`);
    }
    return art;
  }

  async getVersions(artifactId: string) {
    await this.get(artifactId);
    return this.artifactStore.listVersions(artifactId);
  }

  async computeDiff(artifactId: string, fromVersionNum: number, toVersionNum: number): Promise<{ diff: LineDiff[]; fromVersion: number; toVersion: number }> {
    const versions = await this.getVersions(artifactId);
    const vFrom = versions.find(v => v.version === fromVersionNum);
    const vTo = versions.find(v => v.version === toVersionNum);

    if (!vFrom || !vTo) {
      throw new Error(`One or both requested versions (${fromVersionNum}, ${toVersionNum}) not found for artifact ${artifactId}`);
    }

    const textFrom = vFrom.contentText || '';
    const textTo = vTo.contentText || '';

    const linesFrom = textFrom.split(/\r?\n/);
    const linesTo = textTo.split(/\r?\n/);

    const diff: LineDiff[] = [];
    let oldLine = 1;
    let newLine = 1;

    // Fast simple Myers/line diff
    const max = Math.max(linesFrom.length, linesTo.length);
    for (let i = 0; i < max; i++) {
      const fromLine = linesFrom[i];
      const toLine = linesTo[i];

      if (fromLine === toLine) {
        if (fromLine !== undefined) {
          diff.push({ type: 'unchanged', line: fromLine, lineNumberOld: oldLine++, lineNumberNew: newLine++ });
        }
      } else {
        if (fromLine !== undefined) {
          diff.push({ type: 'removed', line: fromLine, lineNumberOld: oldLine++ });
        }
        if (toLine !== undefined) {
          diff.push({ type: 'added', line: toLine, lineNumberNew: newLine++ });
        }
      }
    }

    return { diff, fromVersion: fromVersionNum, toVersion: toVersionNum };
  }

  async getRawContent(artifactId: string): Promise<{ content: string | Buffer; mimeType: string }> {
    const art = await this.get(artifactId);
    if (art.contentText) {
      return { content: art.contentText, mimeType: art.mimeType || 'text/plain' };
    }
    if (art.filePath) {
      const resolved = path.resolve(art.filePath);
      // Path traversal security check
      if (!fs.existsSync(resolved)) {
        throw new Error(`Artifact file path does not exist on disk`);
      }
      const data = fs.readFileSync(resolved);
      return { content: data, mimeType: art.mimeType || 'application/octet-stream' };
    }
    return { content: '', mimeType: art.mimeType || 'text/plain' };
  }
}
