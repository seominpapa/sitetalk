export const ROOM_TYPES = ['일반업무', '협의', '의사결정', '안전', '품질', '설계', '공정', '긴급'] as const;
export interface User { id: string; name: string; email: string; company: string; department: string; role: 'admin' | 'member'; profile_image: string | null; notification_enabled: number }
export interface Room { id: string; site_id: string | null; title: string; purpose: string; type: string; project: string; work_category: string; location: string; keywords: string; status: 'active' | 'closed'; created_by: string; created_at: number; closed_at: number | null; seq: number; unread_count?: number }
export interface Attachment { id: string; filename: string; mime_type: string; file_size: number; message_id: string; room_id: string }
export interface Message { id: string; room_id: string; user_id: string; user_name: string; type: 'text' | 'image' | 'file' | 'system'; content: string; created_at: number; seq: number; attachment?: Attachment }
export interface Closure { conclusion: string; owner_id: string; due_date: string; note: string; closed_at: number }
export interface RoomDetail { room: Room; members: User[]; closure: Closure | null; archive: { status: string; error: string | null } | null }
export type ApiResponse<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };
export interface Site { id: string; name: string }
export interface SummarySchedule { site_id: string; site_name: string; enabled: boolean }
export interface SiteMembership { site_id: string; user_id: string; site_name: string; name: string; email: string; company: string; department: string; role: 'manager' | 'member'; status: 'pending' | 'approved' | 'rejected' }
export interface SiteCreationRequest { id: string; user_id: string; site_name: string; name: string; email: string; company: string; department: string; status: 'pending' | 'approved' | 'rejected'; site_id: string | null; created_at: number; updated_at: number }
export interface AiSettings { configured: boolean; source: 'database' | 'environment' | 'none'; storage_ready: boolean; model: string; updated_at: number | null; last_archive?: { room_id: string; title: string; status: string; error: string | null; updated_at: number } | null }
export interface ConversationSummary { room_id: string; site_id: string; site_name: string; title: string; project: string; closed_at: number; summary: string; decisions: string[]; actions: string[]; keywords: string[]; updated_at: number }
export interface Transcript { room: Room; members: User[]; messages: Message[]; has_more: boolean }
