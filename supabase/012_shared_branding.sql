-- Securely save each business's customization profile without allowing users
-- to change business status, plan, or ownership fields.

begin;

create or replace function public.update_business_brand_settings(p_business_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_settings jsonb;
begin
  if not (public.is_platform_admin() or public.is_business_manager(p_business_id)) then
    raise exception 'Only a business owner or admin can update the shared brand settings.';
  end if;

  update public.businesses
  set brand_settings = coalesce(p_settings, '{}'::jsonb)
  where id = p_business_id
  returning brand_settings into saved_settings;

  if saved_settings is null then
    raise exception 'Business workspace not found.';
  end if;

  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, details)
  values (p_business_id, auth.uid(), 'updated', 'brand_settings', p_business_id::text, '{}'::jsonb);

  return saved_settings;
end;
$$;

revoke all on function public.update_business_brand_settings(uuid, jsonb) from public;
grant execute on function public.update_business_brand_settings(uuid, jsonb) to authenticated;

commit;
