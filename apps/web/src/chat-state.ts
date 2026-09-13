import type { Message } from '../../../packages/shared/types';

export function mergeMessages(current: Message[], incoming: Message[]) {
  return Array.from(new Map([...current, ...incoming].map((message) => [message.id, message])).values()).sort((a, b) => a.seq - b.seq);
}

export async function recoverMessages(fetchPage: (before?: number) => Promise<Message[]>, lastKnownSeq: number) {
  let page = await fetchPage();
  let recovered = page;
  while (lastKnownSeq > 0 && page.length === 50 && page[0].seq > lastKnownSeq + 1) {
    const before = page[0].seq;
    page = await fetchPage(before);
    if (page.length && page[0].seq >= before) throw new Error('이전 메시지 응답이 올바르지 않습니다.');
    recovered = mergeMessages(page, recovered);
  }
  return recovered;
}

export async function fileIdentity(file: File) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return `${file.name}:${file.type}:${Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}
