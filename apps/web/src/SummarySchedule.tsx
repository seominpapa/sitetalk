import { useEffect, useState } from 'react';
import { api } from '../../../packages/shared/api-client';
import type { SummarySchedule } from '../../../packages/shared/types';
import { ErrorNotice, errorMessage } from './ui';

export function SummaryScheduleSettings() {
  const [sites, setSites] = useState<SummarySchedule[]>([]), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [success, setSuccess] = useState('');
  useEffect(() => {
    let active = true;
    api<SummarySchedule[]>('/summary-schedules').then(value => { if (active) setSites(value); }).catch(error => { if (active) setError(errorMessage(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function toggle(site: SummarySchedule) {
    setBusy(site.site_id); setError(''); setSuccess('');
    try {
      const updated = await api<{ site_id: string; enabled: boolean }>(`/sites/${encodeURIComponent(site.site_id)}/summary-schedule`, { method: 'PUT', body: JSON.stringify({ enabled: !site.enabled }) });
      setSites(current => current.map(value => value.site_id === updated.site_id ? { ...value, enabled: updated.enabled } : value));
      setSuccess(`${site.site_name} 자동요약 예약을 ${updated.enabled ? '켰습니다' : '껐습니다'}.`);
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(''); }
  }
  return <section aria-label="자동요약 예약 설정">
    <h3>현장별 자동요약 예약</h3>
    <p className="settings-info">매일 23:50 (한국시간)에 종료된 대화만 요약합니다. 진행 중인 대화는 자동 종료하지 않습니다.</p>
    <p className="settings-info">기존 자동요약은 켜진 상태로 유지됩니다. 예약을 끄면 대기·재시도 작업이 보류되고, 다시 켜면 다음 예약 시 처리됩니다. 이미 시작된 API 요청은 완료될 수 있습니다.</p>
    <p className="settings-info">모든 요약은 관리자가 저장한 공통 API 키·모델을 사용하며 실행 시 API 사용료가 발생합니다. 토글 변경 자체는 API를 호출하지 않습니다.</p>
    <ErrorNotice error={error}/>{success && <p className="success" role="status">{success}</p>}
    {loading ? <p role="status">예약 설정을 불러오는 중…</p> : !sites.length ? <p className="settings-info">관리할 현장이 없습니다.</p> : <div className="approval-list">{sites.map(site => <article key={site.site_id}>
      <strong>{site.site_name}</strong><p>{site.enabled ? '예약 켜짐' : '예약 꺼짐'}</p>
      <div className="approval-actions"><button type="button" role="switch" aria-checked={site.enabled} aria-label={`${site.site_name} 자동요약 예약`} className={site.enabled ? 'primary' : 'secondary'} disabled={!!busy} onClick={() => void toggle(site)}>{busy === site.site_id ? '저장 중…' : site.enabled ? 'ON · 자동요약 켜짐' : 'OFF · 자동요약 꺼짐'}</button></div>
    </article>)}</div>}
  </section>;
}
