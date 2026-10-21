import { useEffect, useRef, useState } from 'react';
import { api } from '../../../packages/shared/api-client';
import type { ConversationSummary, Message, Site, Transcript } from '../../../packages/shared/types';
import { ErrorNotice, Icon, dateTime, errorMessage } from './ui';

export function SiteSummaries({ sites, original }: { sites: Site[]; original: (id: string) => void }) {
  const [site, setSite] = useState(''), [query, setQuery] = useState(''), [items, setItems] = useState<ConversationSummary[]>([]);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), version = useRef(0);
  useEffect(() => { if (!sites.some(value => value.id === site)) setSite(sites[0]?.id || ''); }, [sites, site]);
  useEffect(() => {
    const current = ++version.current; setItems([]); setError('');
    if (!site) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      api<ConversationSummary[]>(`/summaries?site_id=${encodeURIComponent(site)}&q=${encodeURIComponent(query.trim())}`).then(value => { if (current === version.current) setItems(value); }).catch(error => { if (current === version.current) setError(errorMessage(error)); }).finally(() => { if (current === version.current) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); ++version.current; };
  }, [site, query]);
  return <section className="summary-page"><header className="summary-header"><h2>현장 대화 요약</h2><p className="muted">승인된 현장 직원은 해당 현장의 요약과 대화 원문을 읽기 전용으로 열람할 수 있습니다.</p></header>
    <div className="summary-controls"><label>조회 현장<select aria-label="조회 현장" value={site} onChange={event => setSite(event.target.value)}>{sites.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label><label>요약 검색<input aria-label="요약 검색" placeholder="제목, 요약, 결정, 조치, 키워드 검색" value={query} onChange={event => setQuery(event.target.value)} maxLength={100}/></label></div>
    <ErrorNotice error={error}/>{loading ? <p role="status">요약을 검색하는 중…</p> : !items.length ? <p className="muted">{sites.length ? '보관된 요약이 없거나 검색 결과가 없습니다.' : '가입 승인된 현장이 없습니다.'}</p> : <div className="summary-list">{items.map(item => <article className="summary-card" key={item.room_id}><span className="badge">{item.site_name}</span><h3>{item.title}</h3><p className="muted">{item.project} · {dateTime(item.closed_at).toLocaleDateString('ko-KR')}</p><p className="summary-content">{item.summary}</p>{item.decisions.length > 0 && <><h4>결정사항</h4><ul>{item.decisions.map((value, index) => <li key={index}>{value}</li>)}</ul></>}{item.actions.length > 0 && <><h4>후속 조치</h4><ul>{item.actions.map((value, index) => <li key={index}>{value}</li>)}</ul></>}<p className="summary-keywords">{item.keywords.map(value => `#${value}`).join(' ')}</p><a className="secondary" href={`/summaries/${item.room_id}/original`} onClick={event => { event.preventDefault(); original(item.room_id); }}>대화 원문 열람<Icon name="arrow" size={16}/></a></article>)}</div>}</section>;
}

export function OriginalTranscript({ id, back }: { id: string; back: () => void }) {
  const [data, setData] = useState<Transcript | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true; setData(null); setError('');
    api<Transcript>(`/summaries/${encodeURIComponent(id)}/transcript`).then(value => { if (active) setData(value); }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [id]);
  async function older() {
    if (!data?.messages.length || busy) return;
    setBusy(true); setError('');
    try {
      const previous = await api<Transcript>(`/summaries/${encodeURIComponent(id)}/transcript?before=${data.messages[0].seq}`);
      setData(current => current ? { ...current, has_more: previous.has_more, messages: [...previous.messages.filter(value => !current.messages.some(message => message.id === value.id)), ...current.messages] } : previous);
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  function attachment(message: Message) {
    const file = message.attachment;
    return file ? <a className="file-card" href={`/api/summaries/${encodeURIComponent(id)}/attachments/${encodeURIComponent(file.id)}`} download={file.filename}><Icon name="download" size={18}/>{file.filename} 다운로드</a> : null;
  }
  return <section className="summary-page transcript-page"><button className="secondary" onClick={back}><Icon name="back" size={17}/>현장 대화 요약으로</button><ErrorNotice error={error}/>{!data ? !error && <p>대화 원문을 불러오는 중…</p> : <><header className="summary-header"><span className="badge">읽기 전용 원문</span><h2>{data.room.title}</h2><p className="muted">{data.room.purpose}</p><p className="muted">원문 참여자: {data.members.map(value => value.name).join(', ')}</p></header>{data.has_more && <button className="older-button" disabled={busy} onClick={() => void older()}>{busy ? '불러오는 중…' : '이전 원문 더 보기'}</button>}<div className="transcript-messages">{data.messages.map(message => <article className="summary-card" key={message.id}><p className="message-author"><strong>{message.user_name || '시스템'}</strong><time>{dateTime(message.created_at).toLocaleString('ko-KR')}</time></p><p className="summary-content">{message.content}</p>{attachment(message)}</article>)}</div><p className="muted">현장 지식 열람용 원문입니다. 메시지 작성·초대·수정은 할 수 없습니다.</p></>}</section>;
}
