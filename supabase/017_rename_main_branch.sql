-- Rename the default branch display without changing any branch IDs or records.
update public.branches
set name = 'MAIN'
where name = 'Main workspace';
