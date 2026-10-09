-- Enforce one GST type across an invoice, including imports and direct API writes.
begin;
create or replace function public.breezy_validate_invoice_tax_mode()
returns trigger language plpgsql set search_path = '' as $$
declare
  item jsonb;
  amounts jsonb;
  cgst numeric;
  sgst numeric;
  igst numeric;
  has_split boolean := false;
  has_igst boolean := false;
  mode text := new.payload ->> 'gstTaxMode';
begin
  if mode is not null and mode not in ('split', 'igst') then
    raise exception 'Choose either CGST + SGST or IGST for the invoice.';
  end if;
  if new.payload -> 'lineItems' is not null and new.payload -> 'lineItems' <> 'null'::jsonb
    and jsonb_typeof(new.payload -> 'lineItems') <> 'array' then
    raise exception 'Invoice line items could not be read. Review the invoice and try again.';
  end if;
  amounts := jsonb_build_array(new.payload) || case
    when jsonb_typeof(new.payload -> 'lineItems') = 'array' then new.payload -> 'lineItems' else '[]'::jsonb end;
  for item in select value from jsonb_array_elements(amounts) loop
    begin
      cgst := coalesce(nullif(item ->> 'cgstAmount', ''), '0')::numeric;
      sgst := coalesce(nullif(item ->> 'sgstAmount', ''), '0')::numeric;
      igst := coalesce(nullif(item ->> 'igstAmount', ''), '0')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Tax amounts must be valid non-negative numbers.';
    end;
    if cgst < 0 or sgst < 0 or igst < 0 or cgst::text in ('NaN', 'Infinity', '-Infinity')
      or sgst::text in ('NaN', 'Infinity', '-Infinity') or igst::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Tax amounts must be valid non-negative numbers.';
    end if;
    has_split := has_split or cgst > 0 or sgst > 0;
    has_igst := has_igst or igst > 0;
  end loop;
  if (has_split and has_igst) or (mode = 'split' and has_igst) or (mode = 'igst' and has_split) then
    raise exception 'Use one tax type for the entire invoice: either IGST or CGST + SGST. Apply it to all lines before saving.';
  end if;
  return new;
end;
$$;
drop trigger if exists breezy_invoice_tax_mode on public.breezy_invoices;
create trigger breezy_invoice_tax_mode before insert or update on public.breezy_invoices
  for each row execute function public.breezy_validate_invoice_tax_mode();
revoke all on function public.breezy_validate_invoice_tax_mode() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
