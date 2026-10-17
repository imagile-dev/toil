import { describe, expect, it } from 'vitest';
import { mimeType, multipart, multipartFile } from './multipart.js';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('multipart', () => {
  it('is the same bytes for the same content, with the boundary taken from it', () => {
    const data = new TextEncoder().encode('%PDF');
    const a = multipartFile('report.pdf', data);
    expect(multipartFile('report.pdf', data)).toEqual(a);
    expect(a.contentType).toMatch(/^multipart\/form-data; boundary=toil-[0-9a-f]{32}$/);
    const boundary = a.contentType.split('boundary=')[1];
    expect(text(a.body)).toBe(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="report.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF\r\n--${boundary}--\r\n`);
    expect(multipartFile('report.pdf', new TextEncoder().encode('other')).contentType).not.toBe(a.contentType);
  });

  it('writes fields and files in order, and a name cannot break out of its header', () => {
    const { body, contentType } = multipart([
      { name: 'comment', value: 'hi' },
      { name: 'upload', fileName: 'evil"\r\nX-Injected: 1.bin', data: new Uint8Array([1, 2]), contentType: 'application/x-custom' },
    ]);
    const boundary = contentType.split('boundary=')[1];
    const out = text(body);
    expect(out.startsWith(`--${boundary}\r\nContent-Disposition: form-data; name="comment"\r\n\r\nhi\r\n--${boundary}\r\n`)).toBe(true);
    expect(out).toContain('filename="evil%22X-Injected: 1.bin"\r\nContent-Type: application/x-custom\r\n\r\n');
    expect(out).not.toContain('\r\nX-Injected');
  });

  it('knows common types by extension, any case, and falls back to octet-stream', () => {
    expect(mimeType('a.PNG')).toBe('image/png');
    expect(mimeType('archive.tar.gz')).toBe('application/gzip');
    expect(mimeType('README')).toBe('application/octet-stream');
  });
});
