-- Track automatic Team Access email delivery without exposing mail credentials
-- to the browser. The email itself is sent by the send-team-invite Edge Function.
alter table public.business_team_invites
  add column if not exists email_delivery_status text not null default 'not_sent',
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_delivery_error text;

alter table public.business_team_invites
  drop constraint if exists business_team_invites_email_delivery_status_check;

alter table public.business_team_invites
  add constraint business_team_invites_email_delivery_status_check
  check (email_delivery_status in ('not_sent', 'sent', 'failed'));

comment on column public.business_team_invites.email_delivery_status is
  'Delivery result from the secure send-team-invite Edge Function.';

