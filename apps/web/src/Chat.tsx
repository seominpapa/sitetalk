import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../../../packages/shared/api-client';
import type { ApiResponse, Message, RoomDetail, User } from '../../../packages/shared/types';
import { MemberPicker } from './forms';
import { fileIdentity, mergeMessages, recoverMessages } from './chat-state';
import { Avatar, ErrorNotice, Icon, Modal, dateTime, errorMessage, formatBytes } from './ui';

function upload(id: string, file: File, clientId: string, progress: (value: number) => void): Promise<Message> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('POST', `/api/rooms/${encodeURIComponent(id)}/attachments`); xhr.timeout = 120000;
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error('파일 업로드 연결이 끊겼습니다. 다시 시도해 주세요.'));
    xhr.ontimeout = () => reject(new Error('업로드 시간이 초과되었습니다. 연결 상태를 확인해 주세요.'));
    xhr.onload = () => { try { const result = JSON.parse(xhr.responseText) as ApiResponse<Message>; if (!result.success) reject(new Error(result.error.message)); else resolve(result.data); } catch { reject(new Error('파일 업로드 응답을 확인할 수 없습니다.')); } };
    const form = new FormData(); form.append('file', file); form.append('client_id', clientId); xhr.send(form);
  });
}
function CloseRoom({ detail, close, done }: { detail: RoomDetail; close: () => void; done: () => Promise<void> }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    try { await api(`/rooms/${detail.room.id}/close`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await done(); close(); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <Modal title="대화 종료" close={close}><form onSubmit={submit}><p className="muted modal-intro">협의 결과를 기록해 주세요. 종료하면 대화는 읽기 전용으로 보관됩니다.</p><label>결론 <span className="required">*</span><textarea name="conclusion" required rows={4} maxLength={10000} placeholder="합의한 내용과 결정사항을 작성해 주세요."/></label><div className="form-grid"><label>담당자<select name="owner_id" required><option value="">담당자 선택</option>{detail.members.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label>기한<input name="due_date" type="date"/></label></div><label>추가 메모<textarea name="note" rows={3} maxLength={10000} placeholder="후속 조치나 참고할 내용을 남겨 주세요."/></label><ErrorNotice error={error}/><div className="modal-actions"><button type="button" className="secondary" onClick={close}>취소</button><button className="primary" disabled={busy}>{busy ? '종료 중…' : '대화 종료 및 기록'}<Icon name="check" size={17}/></button></div></form></Modal>;
}
function Invite({ detail, close, done }: { detail: RoomDetail; close: () => void; done: () => Promise<void> }) {
  const [users, setUsers] = useState<User[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { api<User[]>(`/users${detail.room.site_id ? `?site_id=${encodeURIComponent(detail.room.site_id)}` : ''}`).then((users) => setUsers(users.filter((user) => !detail.members.some((member) => member.id === user.id)))).catch((error) => setError(errorMessage(error))); }, [detail.members, detail.room.site_id]);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await api(`/rooms/${detail.room.id}/members`, { method: 'POST', body: JSON.stringify({ user_ids: selected }) }); await done(); close(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }
  return <Modal title="참여자" close={close}><div className="current-members">{detail.members.map((user) => <span key={user.id}><Avatar name={user.name} small/>{user.name}<small>{user.department}</small></span>)}</div>{detail.room.status === 'active' && <form onSubmit={submit}><h3>동료 초대하기</h3><MemberPicker users={users} selected={selected} change={setSelected}/><ErrorNotice error={error}/><div className="modal-actions"><button className="primary" disabled={busy || !selected.length}>{busy ? '초대 중…' : `${selected.length}명 초대`}</button></div></form>}</Modal>;
}
export function Chat({ id, user, refreshRooms, back }: { id: string; user: User; refreshRooms: () => Promise<void>; back: () => void }) {
  const [detail, setDetail] = useState<RoomDetail | null>(null), [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState('연결 중');
  const [sending, setSending] = useState(false), [uploading, setUploading] = useState<string | null>(null), [progress, setProgress] = useState(0);
  const [hasOlder, setHasOlder] = useState(false), [loadingOlder, setLoadingOlder] = useState(false);
  const [modal, setModal] = useState<'close' | 'members' | null>(null), [preview, setPreview] = useState<Message | null>(null);
  const [dragging, setDragging] = useState(false), [showDetails, setShowDetails] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null), fileRef = useRef<HTMLInputElement>(null), imageRef = useRef<HTMLInputElement>(null);
  const nearBottom = useRef(true), uploadLock = useRef(false), sendLock = useRef(false), lastRead = useRef(''), alive = useRef(true);
  const retry = useRef<{ content: string; client_id: string } | null>(null);
  const contiguousSeq = useRef(0), pendingUploads = useRef(new Map<string, string>());
  const synchronize = useCallback(async () => {
    try {
      const [room, latest] = await Promise.all([api<RoomDetail>(`/rooms/${id}`), recoverMessages((before) => api<Message[]>(`/rooms/${id}/messages${before ? `?before=${before}` : ''}`), contiguousSeq.current)]);
      if (!alive.current) return;
      if (!contiguousSeq.current) setHasOlder(latest.length === 50);
      contiguousSeq.current = Math.max(contiguousSeq.current, latest.at(-1)?.seq || 0);
      setDetail(room); setMessages((current) => mergeMessages(current, latest)); setError('');
    }
    catch (error) { if (alive.current) setError(errorMessage(error)); }
  }, [id]);
  useEffect(() => {
    alive.current = true; let disposed = false, socket: WebSocket | null = null, timeout: ReturnType<typeof setTimeout> | undefined, attempts = 0;
    const presence = () => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'presence', visible: document.visibilityState === 'visible' })); };
    function connect() {
      if (disposed) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/rooms/${encodeURIComponent(id)}/ws`);
      socket.onopen = () => { if (disposed) return; attempts = 0; setStatus('실시간 연결됨'); presence(); void synchronize(); void refreshRooms(); };
      socket.onmessage = (event) => {
        if (disposed) return;
        try { const data = JSON.parse(event.data); if (data.type === 'message' && data.message?.id) { if (data.message.seq === contiguousSeq.current + 1) contiguousSeq.current = data.message.seq; setMessages((current) => mergeMessages(current, [data.message])); void refreshRooms(); } else if (data.type === 'room_closed' || data.type === 'members_changed') { void synchronize(); void refreshRooms(); } }
        catch { setError('새 메시지를 불러오는 중 문제가 생겼습니다.'); void synchronize(); }
      };
      socket.onclose = () => { if (disposed) return; setStatus('다시 연결 중'); timeout = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 15000)); };
      socket.onerror = () => socket?.close();
    }
    void synchronize(); connect();
    const visibility = () => { presence(); if (document.visibilityState === 'visible') { void synchronize(); void refreshRooms(); } };
    const heartbeat = setInterval(presence, 25000);
    document.addEventListener('visibilitychange', visibility);
    return () => { disposed = true; alive.current = false; clearTimeout(timeout); clearInterval(heartbeat); document.removeEventListener('visibilitychange', visibility); socket?.close(); };
  }, [id, synchronize, refreshRooms]);
  useEffect(() => {
    if (nearBottom.current) { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); setUnseen(false); }
    else setUnseen(true);
    async function markRead() {
      const latest = messages.at(-1);
      if (document.visibilityState !== 'visible' || !nearBottom.current || !latest || lastRead.current === latest.id) return;
      lastRead.current = latest.id;
      try { await api(`/rooms/${id}/read`, { method: 'POST', body: JSON.stringify({ last_read_message_id: latest.id }) }); await refreshRooms(); }
      catch (error) { if (lastRead.current === latest.id) lastRead.current = ''; if (alive.current) setError(errorMessage(error)); }
    }
    void markRead(); document.addEventListener('visibilitychange', markRead);
    const area = scrollRef.current; area?.addEventListener('scroll', markRead);
    return () => { document.removeEventListener('visibilitychange', markRead); area?.removeEventListener('scroll', markRead); };
  }, [messages, id, refreshRooms]);
  async function send(event?: FormEvent) {
    event?.preventDefault(); const content = draft.trim(); if (!content || sendLock.current || detail?.room.status !== 'active') return;
    if (content.length > 10000) { setError('메시지는 10,000자 이내로 작성해 주세요.'); return; }
    sendLock.current = true; setSending(true); setError('');
    const payload = retry.current?.content === content ? retry.current : { content, client_id: crypto.randomUUID() }; retry.current = payload;
    // Sidebar refresh must not keep the composer locked after message delivery.
    try { const message = await api<Message>(`/rooms/${id}/messages`, { method: 'POST', body: JSON.stringify(payload) }); if (!alive.current) return; retry.current = null; nearBottom.current = true; setMessages((current) => mergeMessages(current, [message])); setDraft((current) => current.trim() === content ? '' : current); void refreshRooms(); }
    catch (error) { if (alive.current) setError(errorMessage(error)); } finally { sendLock.current = false; if (alive.current) setSending(false); }
  }
  async function files(list: FileList | File[] | null) {
    if (!list?.length || detail?.room.status !== 'active' || uploadLock.current) return;
    uploadLock.current = true; setError('');
    try {
      for (const file of Array.from(list)) {
        if (!file.size || file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: 비어 있지 않은 20MB 이하 파일을 선택해 주세요.`);
        setUploading(file.name); setProgress(0);
        const fingerprint = await fileIdentity(file);
        const clientId = pendingUploads.current.get(fingerprint) || crypto.randomUUID();
        pendingUploads.current.set(fingerprint, clientId);
        const message = await upload(id, file, clientId, setProgress);
        pendingUploads.current.delete(fingerprint);
        if (!alive.current) return;
        nearBottom.current = true; setMessages((current) => mergeMessages(current, [message]));
      }
      await refreshRooms();
    }
    catch (error) { if (alive.current) setError(errorMessage(error)); } finally { uploadLock.current = false; if (alive.current) { setUploading(null); if (fileRef.current) fileRef.current.value = ''; if (imageRef.current) imageRef.current.value = ''; } }
  }
  async function older() {
    if (!messages.length) return; setLoadingOlder(true);
    const height = scrollRef.current?.scrollHeight || 0;
    try { const previous = await api<Message[]>(`/rooms/${id}/messages?before=${messages[0].seq}`); nearBottom.current = false; setHasOlder(previous.length === 50); setMessages((current) => mergeMessages(current, previous)); requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop += scrollRef.current.scrollHeight - height; }); }
    catch (error) { setError(errorMessage(error)); } finally { setLoadingOlder(false); }
  }
  if (!detail) return <div className="chat-loading"><button className="secondary" onClick={back}><Icon name="back"/>목록으로</button>{error ? <><ErrorNotice error={error}/><button className="secondary" onClick={() => void synchronize()}>다시 시도</button></> : <p>대화를 불러오는 중…</p>}</div>;
  const { room, closure } = detail, closed = room.status === 'closed';
  return <section className="chat-panel" onDragOver={(event) => { if (!closed && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void files(event.dataTransfer.files); }}>
    <header className="chat-header"><button className="icon-button mobile-back" aria-label="대화방 목록으로" onClick={back}><Icon name="back"/></button><div className="chat-heading"><div><span className={`badge ${closed ? '' : 'green'}`}>{closed ? '종료됨' : '진행 중'}</span><span className="room-type">{room.type}</span></div><h2>{room.title}</h2><p>{[room.project, room.work_category, room.location].filter(Boolean).join(' / ') || '함께 협의하고 결정하는 업무 공간'}</p></div><div className="header-actions"><button className="secondary members-button" onClick={() => setModal('members')}><Icon name="people" size={17}/>{detail.members.length}<span>참여자</span></button>{!closed && <button className="secondary" onClick={() => setModal('close')}><Icon name="check" size={16}/><span>대화 종료</span></button>}</div></header>
    <div className="purpose-strip"><div className="purpose-icon"><Icon name="pin" size={16}/></div><strong>대화 목적</strong><p>{room.purpose}</p><button className="text-button" aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}>{showDetails ? '접기' : '상세'}</button></div>
    {showDetails && <div className="room-details"><span>참여자: {detail.members.map((member) => member.name).join(', ')}</span><span>키워드: {(() => { try { return (JSON.parse(room.keywords) as string[]).join(', ') || '없음'; } catch { return room.keywords || '없음'; } })()}</span><span>생성일: {dateTime(room.created_at).toLocaleDateString('ko-KR')}</span></div>}
    <div className="conversation-status"><span className={status === '실시간 연결됨' ? 'live-dot' : 'pending-dot'}/>{status}<span>메시지는 안전하게 기록됩니다</span></div>
    <ErrorNotice error={error}/>
    <div className="messages" ref={scrollRef} onScroll={(event) => { const element = event.currentTarget; nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90; if (nearBottom.current) setUnseen(false); }} role="log" aria-label="대화 메시지" aria-live="polite" aria-relevant="additions">
      {hasOlder && <button className="older-button" disabled={loadingOlder} onClick={() => void older()}>{loadingOlder ? '불러오는 중…' : '이전 메시지 보기'}</button>}
      <div className="conversation-start"><span className="start-icon"><Icon name="chat" size={24}/></span><h3>{room.title}</h3><p>이 대화의 시작입니다. 함께 현장의 답을 찾아보세요.</p></div>
      {messages.map((message, index) => <div key={message.id}>{(index === 0 || dateTime(message.created_at).toDateString() !== dateTime(messages[index - 1].created_at).toDateString()) && <div className="date-divider"><span>{dateTime(message.created_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}</span></div>}{message.type === 'system' ? <p className="system-message">{message.content}</p> : <article className={`message ${message.user_id === user.id ? 'mine' : ''}`}><Avatar name={message.user_name || '사용자'}/><div className="message-main"><div className="message-author"><strong>{message.user_name || '사용자'}</strong>{message.user_id === user.id && <span className="self-label">나</span>}<time dateTime={dateTime(message.created_at).toISOString()}>{dateTime(message.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</time></div>{message.attachment ? <div className="attachment">{message.attachment.mime_type.startsWith('image/') && <button className="image-preview" onClick={() => setPreview(message)} aria-label={`${message.attachment.filename} 크게 보기`}><img src={`/api/attachments/${message.attachment.id}`} alt={message.attachment.filename} loading="lazy" onLoad={() => { if (nearBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }}/></button>}<div className="file-card"><span className="file-icon"><Icon name="file" size={23}/></span><div><strong>{message.attachment.filename}</strong><small>{formatBytes(message.attachment.file_size)}</small></div>{(message.attachment.mime_type === 'application/pdf' || message.attachment.mime_type.startsWith('image/')) && <button className="text-button" onClick={() => setPreview(message)}>미리보기</button>}<a className="icon-button" href={`/api/attachments/${message.attachment.id}?download=1`} download={message.attachment.filename} aria-label={`${message.attachment.filename} 다운로드`}><Icon name="download" size={18}/></a></div></div> : <div className="message-content">{message.content}</div>}</div></article>}</div>)}
      {closed && closure && <div className="closure-card"><div><span className="badge green"><Icon name="check" size={14}/>협의 완료</span><h3>대화의 결론</h3></div><p>{closure.conclusion}</p><dl><div><dt>담당자</dt><dd>{detail.members.find((member) => member.id === closure.owner_id)?.name || '미지정'}</dd></div><div><dt>기한</dt><dd>{closure.due_date || '미지정'}</dd></div></dl>{closure.note && <p className="closure-note">{closure.note}</p>}<div className="archive-state"><Icon name="archive" size={17}/>{detail.archive?.status === 'completed' || detail.archive?.status === 'done' ? <a href={`/api/rooms/${id}/archive`} download>Markdown 기록 다운로드</a> : <span>{detail.archive?.status === 'failed' ? '기록 생성 재시도 대기 중' : '매일 자동으로 Markdown 기록을 생성합니다.'}</span>}</div></div>}
    </div>
    {unseen && <button className="new-message-jump" onClick={() => { nearBottom.current = true; scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); setUnseen(false); }}>새 메시지 보기 ↓</button>}
    {closed ? <div className="closed-composer"><Icon name="archive" size={18}/>종료된 대화입니다. 메시지와 첨부파일은 계속 확인할 수 있습니다.</div> : <div className="composer-wrap"><form className="composer" onSubmit={(event) => void send(event)}><textarea aria-label="메시지 입력" placeholder="메시지를 입력하세요…" value={draft} maxLength={10000} rows={2} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} onPaste={(event) => { const images = Array.from(event.clipboardData.items).filter((item) => item.type.startsWith('image/')).map((item) => item.getAsFile()).filter((file): file is File => !!file); if (images.length) { event.preventDefault(); void files(images); } }}/><div className="composer-toolbar"><div><input className="hidden" type="file" multiple ref={fileRef} onChange={(event) => void files(event.target.files)} aria-label="첨부파일 선택"/><input className="hidden" type="file" accept="image/*" multiple ref={imageRef} onChange={(event) => void files(event.target.files)} aria-label="이미지 선택"/><button type="button" className="attach-button" disabled={!!uploading} onClick={() => fileRef.current?.click()}><Icon name="plus" size={19}/>파일</button><button type="button" className="attach-button" disabled={!!uploading} onClick={() => imageRef.current?.click()}><Icon name="image" size={18}/>이미지</button></div><button className="primary send-button" disabled={sending || !draft.trim()}>{sending ? '전송 중' : '전송'}<Icon name="send" size={16}/></button></div>{uploading && <div className="upload-progress" role="status"><span>{uploading} · {progress}%</span><progress max="100" value={progress}/></div>}</form><div className="composer-hint"><span>Enter 전송 · Shift + Enter 줄바꿈</span><span>이미지 붙여넣기 · 파일 끌어놓기</span></div></div>}
    {dragging && <div className="drop-overlay"><Icon name="file" size={44}/><strong>여기에 파일을 놓으세요</strong><span>이미지와 문서 · 파일당 최대 20MB</span></div>}
    {modal === 'close' && <CloseRoom detail={detail} close={() => setModal(null)} done={async () => { await synchronize(); await refreshRooms(); }}/ >}
    {modal === 'members' && <Invite detail={detail} close={() => setModal(null)} done={synchronize}/>}
    {preview?.attachment && <Modal title={preview.attachment.filename} close={() => setPreview(null)} wide>{preview.attachment.mime_type.startsWith('image/') ? <img className="large-preview" src={`/api/attachments/${preview.attachment.id}`} alt={preview.attachment.filename}/> : <iframe className="pdf-preview" title={preview.attachment.filename} src={`/api/attachments/${preview.attachment.id}`}/>}<div className="modal-actions"><a className="primary" href={`/api/attachments/${preview.attachment.id}?download=1`} download={preview.attachment.filename}><Icon name="download" size={18}/>다운로드</a></div></Modal>}
  </section>;
}
