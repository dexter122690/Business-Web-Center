-- Adds searchable sandpaper grit choices to the shared SKU catalog.
-- Safe to run after 032_inventory_sku_catalog.sql. It does not create stock,
-- expenses, purchase orders, or change any existing record.

begin;

insert into public.inventory_sku_catalog (sku, item_name, category, unit, aliases) values
  ('PTN-SAND-120-001','Sandpaper - 120 grit','Parts & Materials','sheet',array['sandpaper','liha','120 grit','120']),
  ('PTN-SAND-220-001','Sandpaper - 220 grit','Parts & Materials','sheet',array['sandpaper','liha','220 grit','220']),
  ('PTN-SAND-240-001','Sandpaper - 240 grit','Parts & Materials','sheet',array['sandpaper','liha','240 grit','240']),
  ('PTN-SAND-320-001','Sandpaper - 320 grit','Parts & Materials','sheet',array['sandpaper','liha','320 grit','320']),
  ('PTN-SAND-400-001','Sandpaper - 400 grit','Parts & Materials','sheet',array['sandpaper','liha','400 grit','400']),
  ('PTN-SAND-500-001','Sandpaper - 500 grit','Parts & Materials','sheet',array['sandpaper','liha','500 grit','500']),
  ('PTN-SAND-600-001','Sandpaper - 600 grit','Parts & Materials','sheet',array['sandpaper','liha','600 grit','600']),
  ('PTN-SAND-800-001','Sandpaper - 800 grit','Parts & Materials','sheet',array['sandpaper','liha','800 grit','800']),
  ('PTN-SAND-1000-001','Sandpaper - 1000 grit','Parts & Materials','sheet',array['sandpaper','liha','1000 grit','1000']),
  ('PTN-SAND-1200-001','Sandpaper - 1200 grit','Parts & Materials','sheet',array['sandpaper','liha','1200 grit','1200']),
  ('PTN-SAND-1500-001','Sandpaper - 1500 grit','Parts & Materials','sheet',array['sandpaper','liha','1500 grit','1500']),
  ('PTN-SAND-2000-001','Sandpaper - 2000 grit','Parts & Materials','sheet',array['sandpaper','liha','2000 grit','2000']),
  ('PTN-SAND-3000-001','Sandpaper - 3000 grit','Parts & Materials','sheet',array['sandpaper','liha','3000 grit','3000']),
  ('PTN-SAND-5000-001','Sandpaper - 5000 grit','Parts & Materials','sheet',array['sandpaper','liha','5000 grit','5000'])
on conflict (sku) do update set
  item_name = excluded.item_name,
  category = excluded.category,
  unit = excluded.unit,
  aliases = excluded.aliases,
  active = true;

commit;
