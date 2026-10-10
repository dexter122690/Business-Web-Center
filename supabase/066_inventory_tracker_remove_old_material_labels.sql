-- Remove obsolete Inventory Tracker labels after the capitalization correction.
-- Usage history is relinked to the corrected material before the old row is removed.
begin;

with label_map(old_name, new_name) as (values
  ('LIHA 120','Liha 120'),('LIHA 220','Liha 220'),('LIHA 240','Liha 240'),
  ('LIHA 400','Liha 400'),('LIHA 600','Liha 600'),('LIHA 800','Liha 800'),
  ('LIHA 1000','Liha 1000'),('LIHA 1500','Liha 1500'),('LIHA 2000','Liha 2000'),
  ('LIHA 3000','Liha 3000'),('MASILYA 1 Gal','Masilya (1 gal)'),
  ('THINNER Gallon','Thinner (1 gal)'),('PRIMER SURFACER 1L','Primer Surfacer (1 L)'),
  ('Topcoat 1L','Topcoat (1 L)'),('Ceramic Coating Chemical 1 Bottle','Ceramic Coating Chemical (1 bottle)')
)
update public.inventory_tracker_usage_lines line
set material_id = corrected.id, material_name = corrected.item_name
from public.inventory_tracker_materials old
join label_map map on map.old_name = old.item_name
join public.inventory_tracker_materials corrected
  on corrected.business_id = old.business_id
 and corrected.branch_id = old.branch_id
 and corrected.item_name = map.new_name
where line.material_id = old.id;

with label_map(old_name, new_name) as (values
  ('LIHA 120','Liha 120'),('LIHA 220','Liha 220'),('LIHA 240','Liha 240'),
  ('LIHA 400','Liha 400'),('LIHA 600','Liha 600'),('LIHA 800','Liha 800'),
  ('LIHA 1000','Liha 1000'),('LIHA 1500','Liha 1500'),('LIHA 2000','Liha 2000'),
  ('LIHA 3000','Liha 3000'),('MASILYA 1 Gal','Masilya (1 gal)'),
  ('THINNER Gallon','Thinner (1 gal)'),('PRIMER SURFACER 1L','Primer Surfacer (1 L)'),
  ('Topcoat 1L','Topcoat (1 L)'),('Ceramic Coating Chemical 1 Bottle','Ceramic Coating Chemical (1 bottle)')
)
delete from public.inventory_tracker_materials old
using label_map map
where old.item_name = map.old_name
  and exists (
    select 1 from public.inventory_tracker_materials corrected
    where corrected.business_id = old.business_id
      and corrected.branch_id = old.branch_id
      and corrected.item_name = map.new_name
  );

commit;
