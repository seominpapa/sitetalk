import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../packages/shared/api-client';
import type { Room, Site, SiteMembership, SiteCreationRequest, User } from '../../../packages/shared/types';
import { Chat } from './Chat';
import { Login } from './Auth';
import { SiteSummaries, OriginalTranscript } from './Summaries';
import { RoomForm, Settings, Admin } from './forms';
import { Avatar, ErrorNotice, Icon, errorMessage } from './ui';

function pathRoom() { return /^\/rooms\/([^/]+)$/.exec(location.pathname)?.[1] || null; }
function originalRoom() { return /^\/summaries\/([^/]+)\/original$/.exec(location.pathname)?.[1] || null; }
export function App() {
  const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]), [sites, setSites] = useState<Site[]>([]), [memberships, setMemberships] = useState<SiteMembership[]>([]);
  const [siteRequests, setSiteRequests] = useState<SiteCreationRequest[]>([]);
  const [selected, setSelected] = useState<string | null>(pathRoom), [original, setOriginal] = useState<string | null>(originalRoom);
  const [summaries, setSummaries] = useState(location.pathname.startsWith('/summaries'));
  const [filter, setFilter] = useState<'active' | 'closed'>('active'), [query, setQuery] = useState('');
  const [results, setResults] = useState<Room[] | null>(null), [error, setError] = useState('');
  const [modal, setModal] = useState<'room' | 'settings' | 'admin' | null>(null), [notificationPrompt, setNotificationPrompt] = useState(false);
  const queryVersion = useRef(0);
  const refresh = useCallback(async () => {
    try { setRooms(await api<Room[]>('/rooms')); setError(''); } catch (error) { setError(errorMessage(error)); }
  }, []);
  const refreshMemberships = useCallback(async () => {
    try { const [sites, memberships, requests] = await Promise.all([api<Site[]>('/sites'), api<SiteMembership[]>('/me/memberships'), api<SiteCreationRequest[]>('/me/site-requests')]); setSites(sites); setMemberships(memberships); setSiteRequests(requests); }
    catch (error) { setError(errorMessage(error)); }
  }, []);
  useEffect(() => { api<User>('/auth/me').then(setUser).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!user) return;
    void refresh(); void refreshMemberships();
    const id = setInterval(() => { if (document.visibilityState === 'visible') { void refresh(); void refreshMemberships(); } }, 15000);
    return () => clearInterval(id);
  }, [user, refresh, refreshMemberships]);
  useEffect(() => { const pop = () => { setSelected(pathRoom()); setOriginal(originalRoom()); setSummaries(location.pathname.startsWith('/summaries')); }; window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  useEffect(() => {
    const version = ++queryVersion.current;
    if (!query.trim() || !user) { setResults(null); return; }
    const id = setTimeout(() => { api<Room[]>(`/search?q=${encodeURIComponent(query.trim())}`).then((items) => { if (version === queryVersion.current) setResults(items); }).catch((error) => { if (version === queryVersion.current) setError(errorMessage(error)); }); }, 250);
    return () => clearTimeout(id);
  }, [query, user]);
  const select = (id: string | null) => { setSelected(id); setOriginal(null); setSummaries(false); history.pushState(null, '', id ? `/rooms/${id}` : '/'); };
  const showSummaries = () => { setSelected(null); setOriginal(null); setSummaries(true); history.pushState(null, '', '/summaries'); };
  const showOriginal = (id: string) => { setSelected(null); setOriginal(id); setSummaries(true); history.pushState(null, '', `/summaries/${id}/original`); };
  async function logout() {
    try {
      try {
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration(), subscription = await registration?.pushManager?.getSubscription();
          if (subscription) { await api('/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) }); await subscription.unsubscribe(); }
        }
      } catch { console.warn('Push cleanup failed; continuing server logout.'); }
      await api('/auth/logout', { method: 'POST' }); setUser(null); setRooms([]); setMemberships([]); setSites([]); setSiteRequests([]); select(null); setModal(null);
    } catch (error) { setError(errorMessage(error)); throw error; }
  }
  if (loading) return <main className="loading-screen"><span className="brand-icon"><Icon name="chat"/></span><p>업무 공간에 연결하고 있습니다…</p></main>;
  if (!user) return <Login login={(value) => { setUser(value); setNotificationPrompt(true); }}/>;
  const items = results || rooms.filter((room) => room.status === filter);
  const approvedSites = sites.filter(site => user.role === 'admin' || memberships.some(member => member.site_id === site.id && member.status === 'approved'));
  const pending = memberships.some(member => member.status === 'pending');
  return <div className={`app ${selected || summaries ? 'room-selected' : ''} ${summaries ? 'summaries-mode' : ''}`}>
    <nav className="rail" aria-label="주 메뉴">
      <a className="brand-icon" href="/" aria-label="Site Talk 홈" onClick={(event) => { event.preventDefault(); select(null); }}><Icon name="chat" size={25}/></a>
      <button className={`rail-button ${!summaries && filter === 'active' ? 'current' : ''}`} onClick={() => { setFilter('active'); setQuery(''); select(null); }} aria-label="진행 중 대화"><Icon name="chat"/></button>
      <button className="rail-button" onClick={() => { setFilter('closed'); setQuery(''); select(null); }} aria-label="종료된 대화"><Icon name="archive"/></button>
      <button className={`rail-button ${summaries ? 'current' : ''}`} onClick={showSummaries} aria-label="현장 대화 요약"><Icon name="file"/></button>
      <div className="rail-bottom">{user.role === 'admin' && <button className="rail-button" onClick={() => setModal('admin')} aria-label="관리자"><Icon name="people"/></button>}<button className="rail-button" onClick={() => setModal('settings')} aria-label="설정"><Icon name="settings"/></button><button className="profile-button" onClick={() => setModal('settings')} aria-label={`${user.name} 프로필`}><Avatar name={user.name} small/></button></div>
    </nav>
    <aside className="sidebar">
      <div className="sidebar-title"><div><h1>Site Talk<span className="brand-dot">.</span></h1><span>현장 커뮤니케이션</span></div><button className="icon-button" aria-label="알림 설정" onClick={() => setModal('settings')}><Icon name="bell"/></button></div>
      <div className="workspace-label"><span className="live-dot"/>{user.company || '우리 현장'}<span className="workspace-role">{user.role === 'admin' ? '관리자' : '멤버'}</span></div>
      <div className="search-field"><Icon name="search" size={18}/><input aria-label="대화 검색" placeholder="대화, 메시지, 참여자 검색" value={query} onChange={(event) => setQuery(event.target.value)}/>{query && <button className="icon-button" aria-label="검색 지우기" onClick={() => setQuery('')}><Icon name="close" size={15}/></button>}</div>
      <button className="primary new-room" disabled={!approvedSites.length} onClick={() => setModal('room')}><Icon name="plus" size={18}/>새 대화 만들기</button>
      {siteRequests.filter(request => request.status !== 'approved').map(request => <p key={request.id} className="membership-notice" role="status">{request.site_name} · {request.status === 'pending' ? '현장 생성 요청의 관리자 승인을 기다리고 있습니다.' : '현장 생성 요청이 반려되었습니다. 관리자에게 문의해 주세요.'}</p>)}
      {!approvedSites.length && !siteRequests.some(request => request.status !== 'approved') && <p className="membership-notice" role="status">{pending ? '현장 가입 승인 대기 중입니다.' : user.role === 'admin' ? '설정의 승인 설정에서 현장을 등록해 주세요.' : '가입 승인된 현장이 없습니다. 관리자에게 현장 배정을 요청해 주세요.'}</p>}
      <div className="tabs" role="tablist" aria-label="대화방 상태">{(['active', 'closed'] as const).map(status => <button key={status} role="tab" aria-selected={filter === status} className={filter === status ? 'selected' : ''} onClick={() => { setFilter(status); setQuery(''); }}>{status === 'active' ? '진행 중' : '종료됨'} <span>{rooms.filter(room => room.status === status).length}</span></button>)}</div>
      <div className="list-caption">{results ? `검색 결과 · ${results.length}` : '내 대화방'}<span>{items.length}</span></div>
      <div className="room-list"><ErrorNotice error={error}/>{items.map((room) => <button key={room.id} className={`room-item ${room.id === selected ? 'selected' : ''}`} onClick={() => select(room.id)}><div className={`room-symbol ${room.type === '긴급' || room.type === '안전' ? 'safety' : ''}`}><Icon name={room.status === 'closed' ? 'archive' : 'chat'} size={19}/></div><div className="room-text"><div className="room-line"><strong>{room.title}</strong>{!!room.unread_count && <span className="unread">{room.unread_count > 99 ? '99+' : room.unread_count}</span>}</div><p>{room.purpose}</p><div className="room-meta"><span>{room.type}</span>{room.project && <span>{room.project}</span>}</div></div></button>)}{!items.length && <div className="list-empty"><Icon name={results ? 'search' : 'chat'} size={28}/><p>{results ? '검색 결과가 없습니다.' : filter === 'closed' ? '아직 종료된 대화가 없습니다.' : '새로운 협의를 시작해 보세요.'}</p></div>}</div>
      <button className="secondary summary-nav" onClick={showSummaries}>현장 대화 요약 조회</button><div className="sidebar-footer"><span className="live-dot"/>현장의 대화를 업무의 기록으로</div>
    </aside>
    <main className="main-panel">{original ? <OriginalTranscript key={original} id={original} back={showSummaries}/> : summaries ? <><button className="secondary summary-home" onClick={() => select(null)}><Icon name="back" size={16}/>내 대화방</button><SiteSummaries sites={approvedSites} original={showOriginal}/></> : selected ? <Chat key={selected} id={selected} user={user} refreshRooms={refresh} back={() => select(null)}/> : <div className="welcome"><div className="welcome-art"><Icon name="chat" size={52}/><span className="art-badge"><Icon name="check" size={20}/></span></div><span className="eyebrow">A BETTER WAY TO WORK TOGETHER</span><h2>{user.name}님, 안녕하세요.</h2><p>오늘 현장에서 함께 해결할 업무가 있나요?<br/>대화를 시작하고, 결정과 기록을 한곳에 모으세요.</p><button className="primary" disabled={!approvedSites.length} onClick={() => setModal('room')}><Icon name="plus" size={18}/>새 대화 시작하기</button><div className="welcome-features"><div><Icon name="chat"/><strong>목적 있는 대화</strong><span>업무별로 명확하게 협의</span></div><div><Icon name="file"/><strong>현장 자료 공유</strong><span>사진과 문서를 한곳에</span></div><div><Icon name="archive"/><strong>결정과 지식 보관</strong><span>종료된 협의를 현장 기록으로</span></div></div></div>}</main>
    {notificationPrompt && !modal && <div className="notification-prompt" role="status"><Icon name="bell"/><div><strong>Site Talk 알림을 허용하시겠습니까?</strong><p>다른 업무 중에도 새 메시지를 놓치지 마세요.</p></div><button className="primary" onClick={() => { setNotificationPrompt(false); setModal('settings'); }}>알림 설정</button><button className="icon-button" aria-label="나중에" onClick={() => setNotificationPrompt(false)}><Icon name="close"/></button></div>}
    {modal === 'room' && <RoomForm sites={approvedSites} close={() => setModal(null)} user={user} created={(room) => { setModal(null); setFilter('active'); setQuery(''); void refresh(); select(room.id); }}/>}
    {modal === 'settings' && <Settings user={user} memberships={memberships} membershipsChanged={() => void refreshMemberships()} updated={setUser} close={() => setModal(null)} logout={logout}/>}
    {modal === 'admin' && <Admin close={() => setModal(null)} select={(id) => { select(id); setModal(null); }}/>}
  </div>;
}
