alter table public.request_preparations
  add column if not exists photo_paths text[] not null default '{}';

update public.request_preparations
  set photo_paths = array[photo_path]
  where photo_path is not null
    and coalesce(array_length(photo_paths,1),0) = 0;

alter table public.prep_submissions
  add column if not exists photo_paths text[] not null default '{}';

update public.prep_submissions
  set photo_paths = array[photo_path]
  where photo_path is not null
    and coalesce(array_length(photo_paths,1),0) = 0;