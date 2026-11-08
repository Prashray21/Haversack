import { safeStorage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Secret-value store (PRD L6 + ADR 001 §5 amendment c): values entered once,
 * encrypted with Windows-protected storage (safeStorage → DPAPI), NEVER
 * plaintext on disk, never sent to the renderer, never uploaded.
 *
 * FAIL CLOSED: if safeStorage encryption is unavailable, nothing is persisted
 * — values live in memory for this run only and are gone on exit, and the UI
 * is told so (isPersisting=false).
 */

interface SecretFile {
  version: 1;
  /** base64 of safeStorage-encrypted UTF-8 of the value. */
  entries: Record<string, string>;
}

export class SecretStore {
  private memoryOnly: Record<string, string> = {};
  private cache: SecretFile | undefined;

  constructor(private readonly filePath: string) {}

  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  private async load(): Promise<SecretFile> {
    if (this.cache !== undefined) return this.cache;
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, "utf8")) as SecretFile;
      if (raw.version !== 1 || typeof raw.entries !== "object" || raw.entries === null) {
        throw new Error("unexpected shape");
      }
      this.cache = raw;
      return raw;
    } catch {
      return { version: 1, entries: {} };
    }
  }

  private async save(file: SecretFile): Promise<void> {
    this.cache = file;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }

  async set(name: string, value: string): Promise<{ persisted: boolean }> {
    if (this.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value).toString("base64");
      const file = await this.load();
      file.entries[name] = encrypted;
      await this.save(file);
      delete this.memoryOnly[name];
      return { persisted: true };
    }
    // Fail closed: memory only, never written.
    this.memoryOnly[name] = value;
    return { persisted: false };
  }

  async get(name: string): Promise<string | undefined> {
    if (this.isEncryptionAvailable()) {
      const file = await this.load();
      const encrypted = file.entries[name];
      if (encrypted === undefined) return this.memoryOnly[name];
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    }
    return this.memoryOnly[name];
  }

  async delete(name: string): Promise<boolean> {
    let deleted = false;
    const file = await this.load();
    if (file.entries[name] !== undefined) {
      delete file.entries[name];
      await this.save(file);
      deleted = true;
    }
    if (this.memoryOnly[name] !== undefined) {
      delete this.memoryOnly[name];
      deleted = true;
    }
    return deleted;
  }

  async names(): Promise<string[]> {
    const file = await this.load();
    return [...new Set([...Object.keys(file.entries), ...Object.keys(this.memoryOnly)])].sort();
  }
}
