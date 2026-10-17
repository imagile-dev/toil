import { createHash } from 'node:crypto';

/**
 * Upload bodies: multipart/form-data built by hand, and the content types
 * that go with a file name. Built by hand so the boundary is derived from the
 * content: the same upload is the same bytes on every run, which is what lets
 * both front doors be compared request for request. A hash of the content
 * can't occur in the content, which is more than most cover sheets can say.
 */

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** The content type for a file name, by extension; `application/octet-stream` when unknown. */
export function mimeType(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return (dot === -1 ? undefined : MIME[fileName.slice(dot).toLowerCase()]) ?? 'application/octet-stream';
}

/** One part of a multipart body: a plain field, or a file. */
export type MultipartPart =
  | { name: string; value: string }
  | { name: string; fileName: string; data: Uint8Array; contentType?: string };

export interface EncodedBody {
  body: Uint8Array;
  contentType: string;
}

/** A header value with no line breaks and no bare quotes, so a name can't add a header of its own. */
const quoted = (value: string) => value.replace(/[\r\n]/g, '').replace(/"/g, '%22');

/** A multipart/form-data body from its parts, in order, with a boundary fixed by their content. */
export function multipart(parts: readonly MultipartPart[]): EncodedBody {
  const encoder = new TextEncoder();
  const contents = parts.map((part) => ('data' in part ? part.data : encoder.encode(part.value)));
  const hash = createHash('sha256');
  for (const content of contents) hash.update(content);
  const boundary = `toil-${hash.digest('hex').slice(0, 32)}`;

  const chunks: Uint8Array[] = [];
  parts.forEach((part, i) => {
    const disposition =
      'data' in part
        ? `form-data; name="${quoted(part.name)}"; filename="${quoted(part.fileName)}"\r\nContent-Type: ${part.contentType ?? mimeType(part.fileName)}`
        : `form-data; name="${quoted(part.name)}"`;
    chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: ${disposition}\r\n\r\n`), contents[i] as Uint8Array, encoder.encode('\r\n'));
  });
  chunks.push(encoder.encode(`--${boundary}--\r\n`));

  const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** A multipart body with one `file` part, the shape most upload endpoints take. */
export function multipartFile(fileName: string, data: Uint8Array, field = 'file'): EncodedBody {
  return multipart([{ name: field, fileName, data }]);
}
