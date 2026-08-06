-- Shared SKU catalog for fast, consistent inventory, expense, and purchase-order entry.
-- This creates no stock movements and does not change existing expenses or cash records.

begin;

create table if not exists public.inventory_sku_catalog (
  sku text primary key,
  item_name text not null,
  category text not null default 'Parts & Materials',
  unit text not null default 'pc',
  aliases text[] not null default '{}'::text[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_stock_movements
  add column if not exists sku text;

create index if not exists inventory_stock_movements_sku_idx
  on public.inventory_stock_movements (sku);
create index if not exists inventory_sku_catalog_name_idx
  on public.inventory_sku_catalog (lower(item_name));

alter table public.inventory_sku_catalog enable row level security;

drop policy if exists inventory_sku_catalog_read on public.inventory_sku_catalog;
create policy inventory_sku_catalog_read on public.inventory_sku_catalog
for select to authenticated using (active = true);

drop policy if exists inventory_sku_catalog_admin_write on public.inventory_sku_catalog;
create policy inventory_sku_catalog_admin_write on public.inventory_sku_catalog
for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop trigger if exists set_inventory_sku_catalog_updated_at on public.inventory_sku_catalog;
create trigger set_inventory_sku_catalog_updated_at
before update on public.inventory_sku_catalog
for each row execute procedure public.set_updated_at();

insert into public.inventory_sku_catalog (sku, item_name, category, unit, aliases) values
  ('PTN-TAPE-MASK-001','Masking tape','Parts & Materials','roll',array['m tape','masking tape']),
  ('PTN-SAND-REG-001','Sandpaper - regular','Parts & Materials','sheet',array['sandpaper','liha']),
  ('PTN-SAND-PRM-001','Sandpaper - premium','Parts & Materials','sheet',array['premium sandpaper']),
  ('PTN-THIN-STD-001','Standard thinner','Parts & Materials','can',array['thinner','ordinary thinner']),
  ('PTN-THIN-LAC-001','Lacquer thinner','Parts & Materials','can',array['lacquer']),
  ('PTN-THIN-WB-001','Water-based thinner','Parts & Materials','can',array['water based thinner']),
  ('PTN-THIN-P-001','P thinner','Parts & Materials','can',array['p thinner']),
  ('PTN-CLEAR-001','Clear coat','Parts & Materials','can',array['clear']),
  ('PTN-HARD-001','Hardener','Parts & Materials','can',array['hardener']),
  ('PTN-CATA-001','Catalyst','Parts & Materials','can',array['catalyst']),
  ('PTN-TOP-001','Top coat','Parts & Materials','can',array['topcoat']),
  ('PTN-UNDER-001','Undercoat','Parts & Materials','can',array['undercoat']),
  ('PTN-PRIMER-001','Primer','Parts & Materials','can',array['primer']),
  ('PTN-SURFACER-001','Primer surfacer','Parts & Materials','can',array['surfacer','primer surface']),
  ('PTN-PUTTY-POLY-001','Polyester putty','Parts & Materials','can',array['putty']),
  ('PTN-BODY-FILL-001','Body filler','Parts & Materials','can',array['body filler']),
  ('PTN-GLAZE-001','Glazing putty','Parts & Materials','tube',array['glazing']),
  ('PTN-ADH-001','Adhesion promoter','Parts & Materials','can',array['adhesion']),
  ('PTN-SEALER-001','Sealer','Parts & Materials','can',array['sealer']),
  ('PTN-DEGREASE-001','Degreaser','Parts & Materials','can',array['degreaser']),
  ('PTN-RUST-001','Rust converter','Parts & Materials','can',array['rust converter']),
  ('PTN-ANTI-RUST-001','Anti-rust primer','Parts & Materials','can',array['anti rust']),
  ('PTN-COLOR-CUSTOM-001','Custom paint color','Parts & Materials','liter',array['custom color','paint color']),
  ('PTN-BASECOAT-001','Basecoat paint','Parts & Materials','liter',array['base coat']),
  ('PTN-ACRYLIC-001','Acrylic paint','Parts & Materials','liter',array['acrylic']),
  ('PTN-EPOXY-001','Epoxy primer','Parts & Materials','can',array['epoxy']),
  ('PTN-STRIPE-001','Striping paint','Parts & Materials','can',array['stripe']),
  ('PTN-AEROSOL-001','Aerosol spray paint','Parts & Materials','can',array['spray paint']),
  ('PTN-GUN-CUP-001','Spray gun cup','Parts & Materials','pc',array['paint cup']),
  ('PTN-GUN-COMP-001','Spray gun components','Parts & Materials','set',array['spray gun parts']),
  ('PTN-MIX-CUP-001','Mixing cup','Supplies Expense','pc',array['mixing cups']),
  ('PTN-MIX-STICK-001','Mixing stick','Supplies Expense','pc',array['stirrer']),
  ('PTN-FILTER-001','Paint filter','Supplies Expense','pc',array['filter']),
  ('PTN-RAG-001','Cleaning rag','Supplies Expense','pc',array['rags']),
  ('PTN-GLOVE-001','Disposable gloves','Supplies Expense','pair',array['gloves']),
  ('PTN-MASK-001','Respirator mask','Supplies Expense','pc',array['mask','respirator']),
  ('PTN-REPAIR-KIT-001','Tire repair kit','Parts & Materials','set',array['tire repair','tire kit'])
on conflict (sku) do update set
  item_name = excluded.item_name,
  category = excluded.category,
  unit = excluded.unit,
  aliases = excluded.aliases,
  active = true;

commit;
