-- Allow experience letters alongside the existing employee letter types.

begin;

alter table public.breezy_employee_letters
  drop constraint if exists breezy_employee_letters_letter_type_check;

alter table public.breezy_employee_letters
  add constraint breezy_employee_letters_letter_type_check
  check (letter_type in ('offer', 'internship_offer', 'experience', 'termination'));

insert into public.breezy_schema_versions(version)
values ('2026-10-27-add-experience-letters')
on conflict (version) do nothing;

commit;
