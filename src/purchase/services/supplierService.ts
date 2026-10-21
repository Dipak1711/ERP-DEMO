import { dbMessage, supabase } from '../../db/client';
import { mapSupplier } from '../mappers';
import type { Supplier } from '../types';

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(dbMessage(error));
  }
  return (data || []).map((r) => mapSupplier(r as Record<string, unknown>));
}

export async function saveSupplier(supplier: Partial<Supplier>): Promise<number> {
  const payload: Record<string, unknown> = {
    code: supplier.code?.trim(),
    name: supplier.name?.trim(),
    gstin: supplier.gstin?.trim() || null,
    pan: supplier.pan?.trim() || null,
    state: supplier.state?.trim() || null,
    contact_person: supplier.contactPerson?.trim() || null,
    phone: supplier.phone?.trim() || null,
    email: supplier.email?.trim() || null,
    address: supplier.address?.trim() || null,
    default_payment_terms: supplier.defaultPaymentTerms?.trim() || null,
    is_msme: !!supplier.isMsme,
    active: supplier.active !== false,
  };

  if (supplier.id) {
    const { error } = await supabase
      .from('suppliers')
      .update(payload)
      .eq('id', supplier.id);

    if (error) throw new Error(dbMessage(error));
    return supplier.id;
  }

  // If code is not provided, generate a fallback or let it be supplied
  if (!payload.code) {
    payload.code = 'SUP-' + Math.floor(1000 + Math.random() * 9000);
  }

  const { data, error } = await supabase
    .from('suppliers')
    .insert([payload])
    .select('id')
    .single();

  if (error) throw new Error(dbMessage(error));
  return Number(data?.id);
}
