export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export const ok = (data: unknown, status = 200) => Response.json({ success: true, data }, { status, headers });
export function fail(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ success: false, error: { code: error.code, message: error.message } }, { status: error.status, headers });
  console.error('request_failed', error instanceof Error ? error.name : 'unknown');
  return Response.json({ success: false, error: { code: 'INTERNAL', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 500, headers });
}
export function text(value: unknown, name: string, max = 200, required = true): string {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) throw new HttpError(400, 'INVALID_INPUT', `${name} 입력을 확인해 주세요.`);
  return value;
}
export async function json(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'CONTENT_TYPE', 'JSON 요청이 필요합니다.');
  const raw = await limitedBody(request, 32_768);
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, 'INVALID_JSON', '요청 형식이 올바르지 않습니다.'); }
}
export async function limitedBody(request: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get('content-length')) > max) throw new HttpError(413, 'TOO_LARGE', '파일 또는 요청 크기가 너무 큽니다.');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length;
      if (length > max) { await reader.cancel(); throw new HttpError(413, 'TOO_LARGE', '최대 20MB까지 업로드할 수 있습니다.'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
export function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50 || value.some(id => typeof id !== 'string' || !id || id.length > 100)) throw new HttpError(400, 'INVALID_MEMBERS', '참여자는 최대 50명까지 선택해 주세요.');
  return [...new Set(value)] as string[];
}
export function previewMime(bytes: Uint8Array): string {
  // Signature allowlist only, not a malware scanner. Keep nosniff and sandbox on downloads.
  const starts = (...signature: number[]) => signature.every((value,index)=>bytes[index]===value);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start,end));
  if (starts(137,80,78,71,13,10,26,10)) return 'image/png';
  if (starts(255,216,255)) return 'image/jpeg';
  if (['GIF87a','GIF89a'].includes(ascii(0,6))) return 'image/gif';
  if (bytes.length>=12 && ascii(0,4)==='RIFF' && ascii(8,12)==='WEBP') return 'image/webp';
  if (ascii(0,5)==='%PDF-') return 'application/pdf';
  return 'application/octet-stream';
}
export function date(value: unknown): string | null {
  if (value == null || value === '') return null;
  const v = text(value, '기한', 10);
  const parsed = new Date(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v) throw new HttpError(400, 'INVALID_DATE', '유효한 기한을 입력해 주세요.');
  return v;
}
