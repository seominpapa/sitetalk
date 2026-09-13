import type { ApiResponse } from './types';
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options,
    headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const result = await response.json() as ApiResponse<T>;
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}
