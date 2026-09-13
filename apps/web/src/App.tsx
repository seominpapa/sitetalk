import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../../../packages/shared/api-client';
import type { Room, User } from '../../../packages/shared/types';
import { Chat } from './Chat';
import { RoomForm, Settings, Admin } from './forms';
import { Avatar, ErrorNotice, Icon, errorMessage } from './ui';

function pathRoom() { return /^\/rooms\/([^/]+)$/.exec(location.pathname)?.[1] || null; }
function Login({ login }: { login: (user: User) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try { await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) }); login(await api<User>('/auth/me')); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <main className="login-page"><section className="login-story"><div className="brand"><span className="brand-icon"><Icon name="chat" size={25}/></span>Site Talk</div><div><span className="eyebrow">CONSTRUCTION SITE COMMUNICATION</span><h1>현장의 대화를,<br/>업무의 기록으로.</h1><p>함께 협의하고, 명확하게 결정하고.<br/>오늘의 대화가 내일의 현장 지식이 됩니다.</p><div className="story-tags"><span>실시간 업무 협의</span><span>안전한 파일 공유</span><span>대화 기록 보관</span></div></div><small>현장을 연결하는 가장 간결한 방법</small></section><section className="login-panel"><div className="login-card"><span className="eyebrow">YOUR SITE, CONNECTED</span><h2>현장에 연결하세요</h2><p className="muted">발급받은 계정으로 업무 공간에 로그인하세요.</p><form onSubmit={submit}><label>이메일<input type="email" name="email" placeholder="name@company.com" autoComplete="username" required/></label><label>비밀번호<input type="password" name="password" autoComplete="current-password" placeholder="비밀번호 입력" required/></label><ErrorNotice error={error}/><button className="primary full" disabled={busy}>{busy ? '로그인 중…' : '로그인'}<Icon name="arrow" size={18}/></button></form><p className="login-help">계정이 없으신가요? 현장 관리자에게 문의해 주세요.</p></div></section></main>;
}
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selected, setSelected] = useState<string | null>(pathRoom);
  const [filter, setFilter] = useState<'active' | 'closed'>('active');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Room[] | null>(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'room' | 'settings' | 'admin' | null>(null);
  const [notificationPrompt, setNotificationPrompt] = useState(false);
  const queryVersion = useRef(0);
  const refresh = useCallback(async () => {
    try { setRooms(await api<Room[]>('/rooms')); setError(''); } catch (error) { setError(errorMessage(error)); }
  }, []);
  useEffect(() => { api<User>('/auth/me').then(setUser).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (!user) return; void refresh(); const id = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000); return () => clearInterval(id); }, [user, refresh]);
  useEffect(() => { const pop = () => setSelected(pathRoom()); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  useEffect(() => {
    const version = ++queryVersion.current;
    if (!query.trim() || !user) { setResults(null); return; }
    const id = setTimeout(() => { api<Room[]>(`/search?q=${encodeURIComponent(query.trim())}`).then((items) => { if (version === queryVersion.current) setResults(items); }).catch((error) => { if (version === queryVersion.current) setError(errorMessage(error)); }); }, 250);
    return () => clearTimeout(id);
  }, [query, user]);
  const select = (id: string | null) => { setSelected(id); history.pushState(null, '', id ? `/rooms/${id}` : '/'); };
  async function logout() {
    try {
      try {
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          const subscription = await registration?.pushManager?.getSubscription();
          if (subscription) {
            await api('/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
            await subscription.unsubscribe();
          }
        }
      } catch { console.warn('Push cleanup failed; continuing server logout.'); }
      await api('/auth/logout', { method: 'POST' }); setUser(null); setRooms([]); select(null); setModal(null);
    } catch (error) { setError(errorMessage(error)); throw error; }
  }
  if (loading) return <main className="loading-screen"><span className="brand-icon"><Icon name="chat"/></span><p>업무 공간에 연결하고 있습니다…</p></main>;
  if (!user) return <Login login={(value) => { setUser(value); setNotificationPrompt(true); }}/>;
  const items = results || rooms.filter((room) => room.status === filter);
  return <div className={`app ${selected ? 'room-selected' : ''}`}>
    <nav className="rail" aria-label="주 메뉴"><a className="brand-icon" href="/" aria-label="Site Talk 홈" onClick={(event) => { event.preventDefault(); select(null); }}><Icon name="chat" size={25}/></a><button className="rail-button current" onClick={() => { setFilter('active'); setQuery(''); select(null); }} aria-label="진행 중 대화"><Icon name="chat"/></button><button className="rail-button" onClick={() => { setFilter('closed'); setQuery(''); select(null); }} aria-label="종료된 대화"><Icon name="archive"/></button><div className="rail-bottom">{user.role === 'admin' && <button className="rail-button" onClick={() => setModal('admin')} aria-label="관리자"><Icon name="people"/></button>}<button className="rail-button" onClick={() => setModal('settings')} aria-label="설정"><Icon name="settings"/></button><button className="profile-button" onClick={() => setModal('settings')} aria-label={`${user.name} 프로필`}><Avatar name={user.name} small/></button></div></nav>
    <aside className="sidebar"><div className="sidebar-title"><div><h1>Site Talk<span className="brand-dot">.</span></h1><span>현장 커뮤니케이션</span></div><button className="icon-button" aria-label="알림 설정" onClick={() => setModal('settings')}><Icon name="bell"/></button></div><div className="workspace-label"><span className="live-dot"/>{user.company || '우리 현장'}<span className="workspace-role">{user.role === 'admin' ? '관리자' : '멤버'}</span></div><div className="search-field"><Icon name="search" size={18}/><input aria-label="대화 검색" placeholder="대화, 메시지, 참여자 검색" value={query} onChange={(event) => setQuery(event.target.value)}/>{query && <button className="icon-button" aria-label="검색 지우기" onClick={() => setQuery('')}><Icon name="close" size={15}/></button>}</div><button className="primary new-room" onClick={() => setModal('room')}><Icon name="plus" size={18}/>새 대화 만들기</button><div className="tabs" role="tablist" aria-label="대화방 상태"><button role="tab" aria-selected={filter === 'active'} className={filter === 'active' ? 'selected' : ''} onClick={() => { setFilter('active'); setQuery(''); }}>진행 중 <span>{rooms.filter((room) => room.status === 'active').length}</span></button><button role="tab" aria-selected={filter === 'closed'} className={filter === 'closed' ? 'selected' : ''} onClick={() => { setFilter('closed'); setQuery(''); }}>종료됨 <span>{rooms.filter((room) => room.status === 'closed').length}</span></button></div><div className="list-caption">{results ? `검색 결과 · ${results.length}` : '내 대화방'}<span>{items.length}</span></div><div className="room-list"><ErrorNotice error={error}/>{items.map((room) => <button key={room.id} className={`room-item ${room.id === selected ? 'selected' : ''}`} onClick={() => select(room.id)}><div className={`room-symbol ${room.type === '긴급' || room.type === '안전' ? 'safety' : ''}`}><Icon name={room.status === 'closed' ? 'archive' : 'chat'} size={19}/></div><div className="room-text"><div className="room-line"><strong>{room.title}</strong>{!!room.unread_count && <span className="unread">{room.unread_count > 99 ? '99+' : room.unread_count}</span>}</div><p>{room.purpose}</p><div className="room-meta"><span>{room.type}</span>{room.project && <span>{room.project}</span>}</div></div></button>)}{!items.length && <div className="list-empty"><Icon name={results ? 'search' : 'chat'} size={28}/><p>{results ? '검색 결과가 없습니다.' : filter === 'closed' ? '아직 종료된 대화가 없습니다.' : '새로운 협의를 시작해 보세요.'}</p></div>}</div><div className="sidebar-footer"><span className="live-dot"/>현장의 대화를 업무의 기록으로</div></aside>
    <main className="main-panel">{selected ? <Chat key={selected} id={selected} user={user} refreshRooms={refresh} back={() => select(null)}/> : <div className="welcome"><div className="welcome-art"><Icon name="chat" size={52}/><span className="art-badge"><Icon name="check" size={20}/></span></div><span className="eyebrow">A BETTER WAY TO WORK TOGETHER</span><h2>{user.name}님, 안녕하세요.</h2><p>오늘 현장에서 함께 해결할 업무가 있나요?<br/>대화를 시작하고, 결정과 기록을 한곳에 모으세요.</p><button className="primary" onClick={() => setModal('room')}><Icon name="plus" size={18}/>새 대화 시작하기</button><div className="welcome-features"><div><Icon name="chat"/><strong>목적 있는 대화</strong><span>업무별로 명확하게 협의</span></div><div><Icon name="file"/><strong>현장 자료 공유</strong><span>사진과 문서를 한곳에</span></div><div><Icon name="archive"/><strong>결정과 지식 보관</strong><span>종료된 협의를 현장 기록으로</span></div></div></div>}</main>
    {notificationPrompt && !modal && <div className="notification-prompt" role="status"><Icon name="bell"/><div><strong>Site Talk 알림을 허용하시겠습니까?</strong><p>다른 업무 중에도 새 메시지를 놓치지 마세요.</p></div><button className="primary" onClick={() => { setNotificationPrompt(false); setModal('settings'); }}>알림 설정</button><button className="icon-button" aria-label="나중에" onClick={() => setNotificationPrompt(false)}><Icon name="close"/></button></div>}
    {modal === 'room' && <RoomForm close={() => setModal(null)} user={user} created={(room) => { setModal(null); setFilter('active'); setQuery(''); void refresh(); select(room.id); }}/ >}
    {modal === 'settings' && <Settings user={user} updated={setUser} close={() => setModal(null)} logout={logout}/>}
    {modal === 'admin' && <Admin close={() => setModal(null)} select={(id) => { select(id); setModal(null); }}/>}
  </div>;
}
