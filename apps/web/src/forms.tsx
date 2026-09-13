import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../../packages/shared/api-client';
import { ROOM_TYPES, type Room, type User } from '../../../packages/shared/types';
import { Avatar, ErrorNotice, Icon, Modal, errorMessage, formatBytes } from './ui';

export function MemberPicker({ users, selected, change }: { users: User[]; selected: string[]; change: (ids: string[]) => void }) {
  const [query, setQuery] = useState('');
  return <div className="member-picker"><input aria-label="참여자 찾기" placeholder="이름, 회사, 부서로 찾기" value={query} onChange={(event) => setQuery(event.target.value)}/><div className="member-options">{users.filter((user) => `${user.name} ${user.company} ${user.department}`.includes(query)).map((user) => <label key={user.id} className="member-option"><input type="checkbox" checked={selected.includes(user.id)} onChange={(event) => change(event.target.checked ? [...selected, user.id] : selected.filter((id) => id !== user.id))}/><Avatar name={user.name} small/><span><strong>{user.name}</strong><small>{[user.company, user.department].filter(Boolean).join(' · ') || user.email}</small></span></label>)}{!users.length && <p className="muted">추가할 수 있는 사용자가 없습니다.</p>}</div></div>;
}
export function RoomForm({ close, user, created }: { close: () => void; user: User; created: (room: Room) => void }) {
  const [users, setUsers] = useState<User[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { api<User[]>('/users').then((users) => setUsers(users.filter((value) => value.id !== user.id))).catch((error) => setError(errorMessage(error))); }, [user.id]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected.length) { setError('함께 대화할 참여자를 1명 이상 선택해 주세요.'); return; }
    setBusy(true); setError(''); const data = Object.fromEntries(new FormData(event.currentTarget));
    try { const room = await api<Room>('/rooms', { method: 'POST', body: JSON.stringify({ ...data, keywords: String(data.keywords).split(',').map((item) => item.trim()).filter(Boolean), member_ids: selected }) }); created(room); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <Modal title="새 대화 만들기" close={close} wide><form onSubmit={submit}><p className="muted modal-intro">업무의 목적을 정하고, 함께 해결할 동료를 초대하세요.</p><label>대화 제목 <span className="required">*</span><input name="title" placeholder="예: 발파계획 변경 협의" required maxLength={120}/></label><label>대화 목적 <span className="required">*</span><textarea name="purpose" placeholder="어떤 내용을 협의하고 결정해야 하나요?" required maxLength={2000} rows={3}/></label><label>참여자 <span className="required">*</span> <small>나를 포함해 {selected.length + 1}명</small></label><MemberPicker users={users} selected={selected} change={setSelected}/><div className="form-grid"><label>대화 유형<select name="type">{ROOM_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label><label>프로젝트<input name="project" placeholder="프로젝트명" maxLength={120}/></label><label>공종<input name="work_category" placeholder="예: 토공 / 가시설" maxLength={120}/></label><label>위치<input name="location" placeholder="예: A구간 STA 2+350" maxLength={200}/></label></div><label>관련 키워드<input name="keywords" placeholder="쉼표로 구분 · 안전, 발파, 계획변경" maxLength={500}/></label><ErrorNotice error={error}/><div className="modal-actions"><button type="button" className="secondary" onClick={close}>취소</button><button className="primary" disabled={busy}>{busy ? '대화 생성 중…' : '대화 시작하기'}<Icon name="arrow" size={17}/></button></div></form></Modal>;
}
async function pushRegistration() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('이 브라우저는 웹 알림을 지원하지 않습니다. iPhone/iPad에서는 홈 화면에 앱을 추가한 뒤 열어 주세요.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('알림이 허용되지 않았습니다. 브라우저 사이트 설정에서 알림을 허용해 주세요.');
  const { vapid_public_key } = await api<{ vapid_public_key: string | null }>('/settings');
  if (!vapid_public_key) throw new Error('관리자가 알림 서비스를 설정해야 합니다.');
  const registration = await navigator.serviceWorker.ready;
  const bytes = Uint8Array.from(atob(vapid_public_key.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  await api('/push/subscriptions', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
}
export function Settings({ user, updated, close, logout }: { user: User; updated: (value: User) => void; close: () => void; logout: () => Promise<void> }) {
  const [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState('Notification' in window ? Notification.permission : 'unsupported');
  const [enabled, setEnabled] = useState(!!user.notification_enabled);
  const [subscribed, setSubscribed] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    navigator.serviceWorker.getRegistration().then((registration) => registration?.pushManager.getSubscription()).then((subscription) => setSubscribed(!!subscription)).catch((error) => setError(errorMessage(error)));
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try { updated(await api<User>('/auth/me', { method: 'PATCH', body: JSON.stringify({ ...Object.fromEntries(new FormData(event.currentTarget)), notification_enabled: enabled }) })); setSuccess('프로필과 알림 설정을 저장했습니다.'); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function notification(on: boolean) {
    setBusy(true); setError(''); setSuccess('');
    try {
      if (on) await pushRegistration();
      else if ('serviceWorker' in navigator) { const registration = await navigator.serviceWorker.getRegistration(); const subscription = await registration?.pushManager.getSubscription(); if (subscription) { await api('/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) }); await subscription.unsubscribe(); } }
      updated(await api<User>('/auth/me', { method: 'PATCH', body: JSON.stringify({ notification_enabled: on }) })); setEnabled(on); setSubscribed(on); setPermission('Notification' in window ? Notification.permission : 'unsupported'); setSuccess(on ? '새 메시지 알림을 받을 수 있습니다.' : '알림을 껐습니다.');
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <Modal title="프로필 및 설정" close={close}><form onSubmit={save}><div className="profile-heading"><Avatar name={user.name}/><div><strong>{user.name}</strong><p>{user.email}</p></div></div><label>이름<input name="name" defaultValue={user.name} required maxLength={80}/></label><div className="form-grid"><label>회사<input name="company" defaultValue={user.company} maxLength={120}/></label><label>부서<input name="department" defaultValue={user.department} maxLength={120}/></label></div><div className="notification-settings"><div><strong>새 메시지 알림</strong><p>브라우저 권한: {({ granted: '허용됨', denied: '차단됨', default: '아직 요청하지 않음', unsupported: '지원하지 않음' })[permission]}</p><small>현재 보고 있지 않은 대화의 새 메시지를 알려드려요.</small></div><button type="button" className={enabled && subscribed && permission === 'granted' ? 'secondary' : 'primary'} disabled={busy} onClick={() => void notification(!(enabled && subscribed && permission === 'granted'))}>{enabled && subscribed && permission === 'granted' ? '알림 끄기' : '알림 허용'}</button></div><ErrorNotice error={error}/>{success && <p className="success" role="status">{success}</p>}<div className="modal-actions settings-actions"><button type="button" className="text-danger" onClick={() => { setBusy(true); void logout().catch((error) => setError(errorMessage(error))).finally(() => setBusy(false)); }} disabled={busy}>로그아웃</button><button className="primary" disabled={busy}>설정 저장</button></div></form></Modal>;
}
export function Admin({ close, select }: { close: () => void; select: (id: string) => void }) {
  const [data, setData] = useState<{ users: User[]; rooms: Room[]; storage_bytes: number; archive_count: number } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<NonNullable<typeof data>>('/admin/stats').then(setData).catch((error) => setError(errorMessage(error))); }, []);
  return <Modal title="현장 관리" close={close} wide><ErrorNotice error={error}/>{!data ? <p>관리 정보를 불러오는 중…</p> : <><div className="stats-grid"><div><span>등록 사용자</span><strong>{data.users.length}<small>명</small></strong></div><div><span>첨부파일 저장량</span><strong>{formatBytes(data.storage_bytes)}</strong></div><div><span>보관된 기록</span><strong>{data.archive_count}<small>개</small></strong></div></div><h3>사용자 목록</h3><div className="admin-list">{data.users.map((user) => <div key={user.id}><Avatar name={user.name} small/><span><strong>{user.name}</strong><small>{user.email} · {user.department}</small></span><span className="badge">{user.role === 'admin' ? '관리자' : '멤버'}</span></div>)}</div><h3>전체 대화방</h3><div className="admin-list">{data.rooms.map((room) => <button key={room.id} onClick={() => select(room.id)}><Icon name={room.status === 'closed' ? 'archive' : 'chat'}/><span><strong>{room.title}</strong><small>{room.project || '프로젝트 미지정'}</small></span><span className="badge">{room.status === 'closed' ? '종료됨' : '진행 중'}</span></button>)}</div></>}</Modal>;
}
