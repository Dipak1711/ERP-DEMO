import { dbMessage, supabase } from '../../db/client';
import {
  mapPOApproval,
  mapPOEmailLog,
  mapPOItem,
  mapPORevision,
  mapPurchaseOrder,
} from '../mappers';
import type {
  PODetail,
  PurchaseOrder,
  SavePOHeaderInput,
  SavePOItemInput,
} from '../types';

export async function fetchPORegister(): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase
    .from('v_po_register')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(dbMessage(error));
  return (data || []).map((r) => mapPurchaseOrder(r as Record<string, unknown>));
}

export async function fetchPOUrgent(): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase
    .from('v_po_urgent')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(dbMessage(error));
  return (data || []).map((r) => mapPurchaseOrder(r as Record<string, unknown>));
}

export async function fetchPODetail(id: number): Promise<PODetail> {
  // 1. Header (join supplier info if not in table)
  let { data: poData, error: poError } = await supabase
    .from('v_po_register')
    .select('*')
    .eq('id', id)
    .single();

  if (poError || !poData) {
    // Fallback directly to purchase_orders table if view fails
    const { data: poRaw, error: poRawErr } = await supabase
      .from('purchase_orders')
      .select('*, suppliers(name, email)')
      .eq('id', id)
      .single();

    if (poRawErr || !poRaw) {
      throw new Error(dbMessage(poError || poRawErr));
    }

    const sup = (poRaw as Record<string, unknown>).suppliers as Record<string, unknown> | undefined;
    poData = {
      ...poRaw,
      supplier_name: sup?.name,
      supplier_email: sup?.email,
    };
  }

  // 2. Items
  const { data: itemsData, error: itemsError } = await supabase
    .from('purchase_order_items')
    .select('*')
    .eq('po_id', id)
    .order('line_no', { ascending: true });

  if (itemsError) throw new Error(dbMessage(itemsError));

  // 3. Approvals
  const { data: appData, error: appError } = await supabase
    .from('po_approvals')
    .select('*')
    .eq('po_id', id)
    .order('acted_at', { ascending: false });

  if (appError) throw new Error(dbMessage(appError));

  // 4. Revisions
  const { data: revData, error: revError } = await supabase
    .from('po_revisions')
    .select('*')
    .eq('po_id', id)
    .order('rev_no', { ascending: false });

  if (revError) throw new Error(dbMessage(revError));

  // 5. Email Logs
  const { data: emailData, error: emailError } = await supabase
    .from('po_email_log')
    .select('*')
    .eq('po_id', id)
    .order('sent_at', { ascending: false });

  if (emailError) throw new Error(dbMessage(emailError));

  const po = mapPurchaseOrder(poData as Record<string, unknown>);
  return {
    ...po,
    items: (itemsData || []).map((r) => mapPOItem(r as Record<string, unknown>)),
    approvals: (appData || []).map((r) => mapPOApproval(r as Record<string, unknown>)),
    revisions: (revData || []).map((r) => mapPORevision(r as Record<string, unknown>)),
    emailLogs: (emailData || []).map((r) => mapPOEmailLog(r as Record<string, unknown>)),
  };
}

export async function savePO(
  id: number | null,
  header: SavePOHeaderInput,
  items: SavePOItemInput[],
  user: string
): Promise<number> {
  const { data, error } = await supabase.rpc('save_po', {
    p_id: id,
    p_header: header,
    p_items: items,
    p_user: user,
  });

  if (error) throw new Error(dbMessage(error));
  return Number(data);
}

export async function submitPO(id: number, user: string): Promise<void> {
  const { error } = await supabase.rpc('submit_po', {
    p_id: id,
    p_user: user,
  });

  if (error) throw new Error(dbMessage(error));
}

export async function decidePO(
  id: number,
  approve: boolean,
  note: string,
  user: string
): Promise<void> {
  const { error } = await supabase.rpc('decide_po', {
    p_id: id,
    p_approve: approve,
    p_note: note,
    p_user: user,
  });

  if (error) throw new Error(dbMessage(error));
}

export async function releasePO(id: number, user: string): Promise<void> {
  const { error } = await supabase.rpc('release_po', {
    p_id: id,
    p_user: user,
  });

  if (error) throw new Error(dbMessage(error));
}

export async function amendPO(id: number, reason: string, user: string): Promise<number> {
  const { data, error } = await supabase.rpc('amend_po', {
    p_id: id,
    p_reason: reason,
    p_user: user,
  });

  if (error) throw new Error(dbMessage(error));
  return Number(data);
}

export async function uploadPOAttachment(file: File): Promise<{ name: string; path: string }> {
  const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const path = `${Date.now()}_${cleanName}`;

  const { error } = await supabase.storage.from('po-attachments').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });

  if (error) throw new Error(dbMessage(error));
  return { name: file.name, path };
}

export async function getPOAttachmentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('po-attachments').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    throw new Error(dbMessage(error) || 'Could not generate download URL');
  }
  return data.signedUrl;
}
