-- Normalize the Inventory Tracker material labels for consistent grammar and capitalization.
begin;

update public.inventory_tracker_materials
set item_name = case item_name
  when 'LIHA 120' then 'Liha 120'
  when 'LIHA 220' then 'Liha 220'
  when 'LIHA 240' then 'Liha 240'
  when 'LIHA 400' then 'Liha 400'
  when 'LIHA 600' then 'Liha 600'
  when 'LIHA 800' then 'Liha 800'
  when 'LIHA 1000' then 'Liha 1000'
  when 'LIHA 1500' then 'Liha 1500'
  when 'LIHA 2000' then 'Liha 2000'
  when 'LIHA 3000' then 'Liha 3000'
  when 'MASILYA 1 Gal' then 'Masilya (1 gal)'
  when 'THINNER Gallon' then 'Thinner (1 gal)'
  when 'PRIMER SURFACER 1L' then 'Primer Surfacer (1 L)'
  when 'Topcoat 1L' then 'Topcoat (1 L)'
  when 'Ceramic Coating Chemical 1 Bottle' then 'Ceramic Coating Chemical (1 bottle)'
  else item_name
end
where item_name in (
  'LIHA 120','LIHA 220','LIHA 240','LIHA 400','LIHA 600','LIHA 800','LIHA 1000','LIHA 1500','LIHA 2000','LIHA 3000',
  'MASILYA 1 Gal','THINNER Gallon','PRIMER SURFACER 1L','Topcoat 1L','Ceramic Coating Chemical 1 Bottle'
);

commit;
