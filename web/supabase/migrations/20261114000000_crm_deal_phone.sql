-- =============================================================================
-- Cubes CRM — a phone number on the deal itself
-- =============================================================================
-- Deals are often captured as raw leads (a pasted WhatsApp message, a form
-- reply) before anyone becomes a contact record, so the number to call has to
-- live somewhere the moment the deal exists. It is deliberately NOT a mirror of
-- app_crm_people.phone: a linked contact keeps its own number, and this column
-- is the number attached to THIS opportunity.
-- =============================================================================

alter table public.app_crm_deals
    add column if not exists phone text;

do $$
begin
    alter table public.app_crm_deals
        add constraint app_crm_deals_phone_check check (char_length(phone) <= 40);
exception
    when duplicate_object then null;
end $$;
