export interface ArchiveFile {
  path: string;
  data: Buffer;
}
export function readUstar(buffer: Buffer): { files: ArchiveFile[]; refused: string[] };
export function inspect(
  buffer: Buffer,
  deletedText: string,
  areas: string[],
): { ok: boolean; area: string | undefined; refused: string[]; files: ArchiveFile[]; deleted: string[] };
export function extract(inspected: { files: ArchiveFile[]; deleted: string[] }, dest: string): void;
