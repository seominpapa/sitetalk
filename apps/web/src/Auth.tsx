import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../../packages/shared/api-client';
import type { Site, User } from '../../../packages/shared/types';
import { validRegistrationPassword, REGISTRATION_PASSWORD_MESSAGE, REGISTRATION_PASSWORD_MIN_LENGTH, REGISTRATION_PASSWORD_CONFIRMATION_MESSAGE } from '../../../packages/shared/password-policy';
import { ErrorNotice, Icon, errorMessage } from './ui';

export function Login({ login }: { login: (user: User) => void }) {
  const [register, setRegister] = useState(false), [sites, setSites] = useState<Site[]>([]);
  const [registrationType, setRegistrationType] = useState<'member' | 'manager'>('member');
  const [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (register) api<Site[]>('/sites').then(setSites).catch(error => setError(errorMessage(error))); }, [register]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (register) {
        if (typeof form.password !== 'string' || !validRegistrationPassword(form.password)) throw new Error(REGISTRATION_PASSWORD_MESSAGE);
        if (form.password !== form.password_confirmation) throw new Error(REGISTRATION_PASSWORD_CONFIRMATION_MESSAGE);
        await api('/auth/register', { method: 'POST', body: JSON.stringify(form) });
        setRegister(false); setSuccess(registrationType === 'manager' ? '가입 및 현장 생성 요청을 접수했습니다. 관리자가 승인하면 현장이 생성되고 현장담당자로 배정됩니다.' : '가입 신청을 접수했습니다. 현장담당자 또는 관리자의 승인 후 현장 대화에 참여할 수 있습니다.');
      } else {
        await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: form.email, password: form.password }) });
        login(await api<User>('/auth/me'));
      }
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-story"><div className="brand"><span className="brand-icon"><Icon name="chat" size={25}/></span>Site Talk</div><div><span className="eyebrow">CONSTRUCTION SITE COMMUNICATION</span><h1>현장의 대화를,<br/>업무의 기록으로.</h1><p>함께 협의하고, 명확하게 결정하고.<br/>오늘의 대화가 내일의 현장 지식이 됩니다.</p><div className="story-tags"><span>실시간 업무 협의</span><span>안전한 파일 공유</span><span>대화 기록 보관</span></div></div><small>현장을 연결하는 가장 간결한 방법</small></section>
    <section className="login-panel"><div className="login-card">
      <span className="eyebrow">YOUR SITE, CONNECTED</span><h2>{register ? '현장 가입 신청' : '현장에 연결하세요'}</h2>
      <p className="muted">{register ? '팀원 가입 또는 현장담당자의 새 현장 생성 요청을 신청하세요.' : '계정으로 업무 공간에 로그인하세요.'}</p>
      <form key={String(register)} onSubmit={submit}>
        {register && <>
          <label>가입 유형<select name="registration_type" value={registrationType} onChange={event => { setRegistrationType(event.target.value as 'member' | 'manager'); setError(''); }}><option value="member">현장 팀원</option><option value="manager">현장담당자 · 새 현장 생성 요청</option></select></label>
          <label>이름<input name="name" required maxLength={80} autoComplete="name"/></label>
          <div className="form-grid"><label>회사<input name="company" maxLength={100}/></label><label>부서<input name="department" maxLength={100}/></label></div>
        </>}
        <label>이메일<input type="email" name="email" placeholder="name@company.com" autoComplete="username" required maxLength={254}/></label>
        <label>비밀번호<input type="password" name="password" autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? '8자 이상 · 숫자·특수문자 포함' : '비밀번호 입력'} minLength={register ? REGISTRATION_PASSWORD_MIN_LENGTH : undefined} aria-describedby={register ? 'registration-password-help' : undefined} maxLength={128} required/></label>
        {register && <>
          <p id="registration-password-help" className="muted">{REGISTRATION_PASSWORD_MESSAGE}</p>
          <label>비밀번호 확인<input type="password" name="password_confirmation" autoComplete="new-password" placeholder="비밀번호를 한 번 더 입력" minLength={REGISTRATION_PASSWORD_MIN_LENGTH} maxLength={128} required/></label>
          {registrationType === 'manager' ? <>
            <label>요청할 현장 이름<input name="site_name" required maxLength={120}/></label>
            <p className="settings-info">관리자가 승인하면 현장이 생성되고 현장담당자로 배정됩니다.</p>
          </> : <label>가입할 현장<select name="site_id" required defaultValue=""><option value="" disabled>현장 선택</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}
        </>}
        <ErrorNotice error={error}/>{success && <p className="success" role="status">{success}</p>}
        <button className="primary full" disabled={busy || (register && registrationType === 'member' && !sites.length)}>{busy ? '처리 중…' : register ? '가입 승인 요청' : '로그인'}<Icon name="arrow" size={18}/></button>
      </form>
      <p className="login-help"><button type="button" className="text-button" disabled={busy} onClick={() => { setRegister(!register); setRegistrationType('member'); setError(''); setSuccess(''); }}>{register ? '로그인으로 돌아가기' : '가입 신청'}</button></p>
    </div></section>
  </main>;
}
