import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../../packages/shared/api-client';
import { SUMMARY_MODELS } from '../../../packages/shared/ai-models';
import type { AiSettings, Site, SiteMembership, SiteCreationRequest, User } from '../../../packages/shared/types';
import { ErrorNotice, dateTime, errorMessage } from './ui';

export function AiConfiguration() {
  const [settings, setSettings] = useState<AiSettings | null>(null), [model, setModel] = useState('gpt-4.1-mini');
  const [key, setKey] = useState(''), [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { api<AiSettings>('/admin/ai-settings').then(value => { setSettings(value); setModel(value.model); }).catch(error => setError(errorMessage(error))); }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      const value = await api<AiSettings>('/admin/ai-settings', { method: 'PUT', body: JSON.stringify({ model, ...(key.trim() ? { api_key: key.trim() } : {}) }) });
      setKey(''); setSettings(value); setSuccess('AI 요약 설정을 저장했습니다. 실제 API 연결과 잔액은 요약 실행 시 확인됩니다.');
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <section aria-label="AI 요약 설정">
    <h3>공통 OpenAI API 설정</h3><p className="muted">모든 현장의 대화 요약에 공통으로 사용합니다.</p><ErrorNotice error={error}/>
    {settings ? <form onSubmit={save}>
      <p className="settings-info">키 등록: {settings.configured ? '등록됨' : '미등록'} · {settings.source === 'database' ? '관리자 설정 사용' : settings.source === 'environment' ? '서버 환경 설정 사용' : 'API 키가 필요합니다'}</p>
      {!settings.storage_ready && <p className="error" role="alert">서버의 API 키 암호화 설정이 필요합니다. 배포 전에 관리자가 암호화 키를 구성해야 합니다.</p>}
      <label>OpenAI API 키<input type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder={settings.source === 'database' ? '변경할 때만 입력' : 'API 키 입력'} maxLength={503}/></label>
      <p className="muted">저장한 키는 다시 표시하지 않습니다. 관리자 설정에 저장된 키는 빈칸으로 저장하면 유지합니다.</p>
      {settings.source === 'environment' && <p className="settings-info">서버 환경 키를 관리자 설정으로 전환하려면 API 키를 입력해 주세요.</p>}
      <label>요약 모델<select value={model} onChange={event => setModel(event.target.value)}>{SUMMARY_MODELS.map(value => <option key={value}>{value}</option>)}</select></label>
      <p className="settings-info">자동 보관: 매일 23:50 (한국시간). 설정 저장은 유료 API를 호출하지 않으며, 실제 요약 실행 시 OpenAI 사용료가 발생합니다.</p>
      <div className="settings-section"><h4>마지막 자동 보관 결과</h4>{settings.last_archive ? <><p className="settings-info">{settings.last_archive.title} · {({ done: '성공', failed: '실패', pending: '대기 중', processing: '처리 중' } as Record<string, string>)[settings.last_archive.status] || settings.last_archive.status} · {dateTime(settings.last_archive.updated_at).toLocaleString('ko-KR')}</p>{settings.last_archive.error && <p className="error">{settings.last_archive.error}</p>}</> : <p className="settings-info">아직 자동 보관 기록이 없습니다.</p>}</div>
      {success && <p className="success" role="status">{success}</p>}
      <div className="modal-actions"><button className="primary" disabled={busy || !settings.storage_ready || (settings.source !== 'database' && !key.trim())}>{busy ? '저장 중…' : 'AI 설정 저장'}</button></div>
    </form> : <p>설정을 불러오는 중…</p>}
  </section>;
}

export function ApprovalSettings({ user, changed }: { user: User; changed: () => void }) {
  const [members, setMembers] = useState<SiteMembership[]>([]), [sites, setSites] = useState<Site[]>([]), [users, setUsers] = useState<User[]>([]);
  const [siteRequests, setSiteRequests] = useState<SiteCreationRequest[]>([]);
  const [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  async function load() {
    const approvals = await api<SiteMembership[]>('/approvals'); setMembers(approvals);
    if (user.role === 'admin') {
      const [sites, stats, requests] = await Promise.all([api<Site[]>('/sites'), api<{ users: User[] }>('/admin/stats'), api<SiteCreationRequest[]>('/admin/site-requests')]);
      setSites(sites); setUsers(stats.users); setSiteRequests(requests);
    }
  }
  useEffect(() => { load().catch(error => setError(errorMessage(error))).finally(() => setLoading(false)); }, []);
  async function action(run: () => Promise<unknown>, message: string) {
    setBusy(true); setError(''); setSuccess('');
    try { await run(); await load(); changed(); setSuccess(message); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  function approve(member: SiteMembership, status: 'approved' | 'rejected', role: 'manager' | 'member') {
    return action(() => api(`/sites/${member.site_id}/members/${member.user_id}`, { method: 'PUT', body: JSON.stringify({ status, role }) }), `${member.name}님의 현장 권한을 변경했습니다.`);
  }
  function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void action(() => api(`/sites/${form.get('site_id')}/members/${form.get('user_id')}`, { method: 'PUT', body: JSON.stringify({ status: 'approved', role: form.get('role') }) }), '현장 소속과 권한을 지정했습니다.');
  }
  function createSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, name = String(new FormData(form).get('name') || '').trim();
    void action(async () => { await api('/sites', { method: 'POST', body: JSON.stringify({ name }) }); form.reset(); }, '현장을 등록했습니다.');
  }
  function reviewSite(request: SiteCreationRequest, status: 'approved' | 'rejected') {
    return action(() => api(`/admin/site-requests/${request.id}`, { method: 'PUT', body: JSON.stringify({ status }) }), status === 'approved' ? '현장을 생성하고 신청자를 현장담당자로 승인했습니다.' : '현장 생성 요청을 반려했습니다.');
  }
  return <section aria-label="승인 설정">
    <h3>가입 승인 및 담당자 지정</h3><p className="muted">{user.role === 'admin' ? '모든 현장의 가입을 승인하고 팀원을 현장담당자로 지정할 수 있습니다.' : '담당 현장의 승인 대기 팀원만 승인하거나 반려할 수 있습니다.'}</p>
    <ErrorNotice error={error}/>{success && <p className="success" role="status">{success}</p>}
    {user.role === 'admin' && <>
      <div className="settings-section"><h4>현장 생성 요청</h4>
        {loading ? <p>현장 생성 요청을 불러오는 중…</p> : !siteRequests.length ? <p className="muted">현장 생성 요청이 없습니다.</p> : <div className="approval-list">{siteRequests.map(request => <article key={request.id}>
          <strong>{request.site_name}</strong><p>{request.name} · {request.email}</p><p>{request.company} {request.department}</p>
          <p>현장담당자 신청 · {({ pending: '승인 대기', approved: '승인됨', rejected: '반려됨' })[request.status]}</p>
          {request.status === 'pending' && <div className="approval-actions">
            <button className="secondary" disabled={busy} aria-label={`${request.name} 현장 생성 승인`} onClick={() => void reviewSite(request, 'approved')}>현장 생성 및 담당자 승인</button>
            <button className="text-danger" disabled={busy} aria-label={`${request.name} 현장 생성 반려`} onClick={() => void reviewSite(request, 'rejected')}>반려</button>
          </div>}
        </article>)}</div>}
      </div>
      <form onSubmit={createSite} className="settings-section"><label>새 현장 이름<input name="name" required maxLength={120}/></label><div className="modal-actions"><button className="secondary" disabled={busy}>현장 등록</button></div></form>
      <form onSubmit={assign} className="settings-section"><h4>기존 사용자 현장 배정</h4><label>배정 현장<select name="site_id" required><option value="">현장 선택</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label>배정할 사용자<select name="user_id" required><option value="">사용자 선택</option>{users.map(value => <option key={value.id} value={value.id}>{value.name} · {value.email}</option>)}</select></label><label>현장 역할<select name="role"><option value="member">팀원</option><option value="manager">현장담당자</option></select></label><div className="modal-actions"><button className="secondary" disabled={busy}>배정 및 승인</button></div></form>
    </>}
    <h4 className="settings-section">현장별 가입 및 승인 현황</h4>{loading ? <p>승인 현황을 불러오는 중…</p> : !members.length ? <p className="muted">처리할 가입 신청이 없습니다.</p> : <div className="approval-list">{members.map(member => <article key={`${member.site_id}:${member.user_id}`}><strong>{member.name}</strong><p>{member.site_name} · {member.email}</p><p>{member.role === 'manager' ? '현장담당자' : '팀원'} · {({ pending: '승인 대기', approved: '승인됨', rejected: '반려됨' })[member.status]}</p><div className="approval-actions">{member.status === 'pending' && <><button className="secondary" disabled={busy} aria-label={`${member.name} 팀원으로 승인`} onClick={() => void approve(member, 'approved', 'member')}>팀원 승인</button><button className="text-danger" disabled={busy} aria-label={`${member.name} 가입 반려`} onClick={() => void approve(member, 'rejected', 'member')}>반려</button></>}{user.role === 'admin' && member.role === 'member' && <button className="secondary" disabled={busy} aria-label={`${member.name} 현장담당자로 ${member.status === 'approved' ? '승격' : '승인'}`} onClick={() => void approve(member, 'approved', 'manager')}>{member.status === 'approved' ? '현장담당자로 승격' : '현장담당자로 승인'}</button>}{user.role === 'admin' && member.status === 'rejected' && <button className="secondary" disabled={busy} onClick={() => void approve(member, 'approved', 'member')}>팀원으로 재승인</button>}</div></article>)}</div>}
  </section>;
}
