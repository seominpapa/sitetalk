import type { Env } from './env';
import type { User } from '../../../packages/shared/types';
import { HttpError, json, ok } from './http.ts';

const forbidden = () => new HttpError(403, 'FORBIDDEN', '관리자 또는 승인된 현장담당자만 자동요약 예약을 설정할 수 있습니다.');
export async function summaryScheduleRoutes(request: Request, env: Env, user: User): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/summary-schedules' && request.method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT s.id site_id,s.name site_name,s.auto_summary_enabled FROM sites s
      WHERE ?='admin' OR EXISTS(SELECT 1 FROM site_memberships sm WHERE sm.site_id=s.id AND sm.user_id=? AND sm.role='manager' AND sm.status='approved')
      ORDER BY s.name,s.id`).bind(user.role, user.id).all<{ site_id: string; site_name: string; auto_summary_enabled: number }>();
    if (user.role !== 'admin' && !results.length) throw forbidden();
    return ok(results.map(({ auto_summary_enabled, ...site }) => ({ ...site, enabled: auto_summary_enabled === 1 })));
  }
  const match = path.match(/^\/api\/sites\/([^/]+)\/summary-schedule$/);
  if (!match || request.method !== 'PUT') return null;
  const body = await json(request);
  if (typeof body.enabled !== 'boolean' || Object.keys(body).length !== 1) throw new HttpError(400, 'INVALID_SCHEDULE', '자동요약 예약 여부는 true 또는 false로 입력해 주세요.');
  const updated = await env.DB.prepare(`UPDATE sites SET auto_summary_enabled=? WHERE id=? AND
    (?='admin' OR EXISTS(SELECT 1 FROM site_memberships sm WHERE sm.site_id=sites.id AND sm.user_id=? AND sm.role='manager' AND sm.status='approved'))
    RETURNING id`).bind(body.enabled ? 1 : 0, match[1], user.role, user.id).first();
  if (!updated) {
    if (user.role === 'admin') throw new HttpError(404, 'SITE_NOT_FOUND', '현장을 찾을 수 없습니다.');
    throw forbidden();
  }
  return ok({ site_id: match[1], enabled: body.enabled });
}
