-- Allow internship offer letters alongside employment offers and terminations.

begin;

alter table public.breezy_employee_letters
  drop constraint if exists breezy_employee_letters_letter_type_check;

alter table public.breezy_employee_letters
  add constraint breezy_employee_letters_letter_type_check
  check (letter_type in ('offer', 'internship_offer', 'termination'));

commit;
