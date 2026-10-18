import { auditLine, DEFAULT_AUDIT, parseAuditLine, type AuditEntry, type AuditLog, type AuditSettings } from '../../src/core/audit.js';

/** An audit log in memory: `lines` holds exactly what the file log would have appended, newline and all. */
export interface MemoryAudit extends AuditLog {
  lines: string[];
  entries: () => AuditEntry[];
}

export function memoryAudit(settings: Partial<AuditSettings> = {}): MemoryAudit {
  const lines: string[] = [];
  const resolved = { ...DEFAULT_AUDIT, ...settings };
  return {
    dir: '/home/test/.toil/audit',
    configFile: '/home/test/.toil/config.json',
    settings: resolved,
    lines,
    append(entry) {
      if (resolved.enabled) lines.push(auditLine(entry));
    },
    read(since) {
      const entries = lines.map(parseAuditLine).filter((e): e is AuditEntry => e !== undefined);
      return { entries: since ? entries.filter((e) => Date.parse(e.time) >= Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1)) : entries, unreadable: lines.length - entries.length };
    },
    entries: () => lines.map((l) => parseAuditLine(l)!),
  };
}
