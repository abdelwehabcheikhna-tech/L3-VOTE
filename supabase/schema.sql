-- L3 VOTE : schéma de départ Supabase
-- À exécuter dans Supabase > SQL Editor.
-- Le vote est séparé du profil : la table ballots ne contient PAS user_id.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.student_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  matricule text not null unique,
  filiere text not null,
  attestation_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  has_voted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  filiere text not null,
  display_order int not null unique
);

create table if not exists public.ballots (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id),
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attestations','attestations',false,5242880,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

insert into public.candidates(full_name,filiere,display_order) values
('Youssef','Chimie',1),
('Mouhamed Vall','EEA',2),
('Issa Hamza','DAII',3),
('El Hassen Sy','TSER',4),
('Mohamed','PF',5),
('Cheikh','SP',6),
('Oumar Mouhamedou','MA',7)
on conflict (display_order) do nothing;

alter table public.admin_users enable row level security;
alter table public.student_profiles enable row level security;
alter table public.candidates enable row level security;
alter table public.ballots enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists(select 1 from public.admin_users where user_id = auth.uid());
$$;

drop policy if exists "profile insert own" on public.student_profiles;
create policy "profile insert own" on public.student_profiles
for insert to authenticated with check (user_id = auth.uid() and status = 'pending' and has_voted = false);

drop policy if exists "profile read own or admin" on public.student_profiles;
create policy "profile read own or admin" on public.student_profiles
for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "admin update profiles" on public.student_profiles;
create policy "admin update profiles" on public.student_profiles
for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "candidates visible" on public.candidates;
create policy "candidates visible" on public.candidates
for select to authenticated using (true);

drop policy if exists "admin read ballots" on public.ballots;
create policy "admin read ballots" on public.ballots
for select to authenticated using (public.is_admin());

-- Chaque étudiant ne peut voter qu'une fois. La fonction vérifie son identité
-- dans student_profiles, mais n'inscrit jamais son user_id dans ballots.
create or replace function public.cast_vote(p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Connecte-toi pour voter.';
  end if;

  if not exists (
    select 1 from public.student_profiles
    where user_id = auth.uid() and status = 'approved' and has_voted = false
    for update
  ) then
    raise exception 'Compte non autorisé, ou vote déjà effectué.';
  end if;

  if not exists (select 1 from public.candidates where id = p_candidate_id) then
    raise exception 'Candidat invalide.';
  end if;

  insert into public.ballots(candidate_id) values (p_candidate_id);
  update public.student_profiles set has_voted = true where user_id = auth.uid();
end;
$$;

revoke all on function public.cast_vote(uuid) from public;
grant execute on function public.cast_vote(uuid) to authenticated;

-- Le tableau de résultats n'est accessible qu'aux administrateurs.
create or replace function public.admin_vote_results()
returns table(candidate_id uuid, candidate_name text, filiere text, vote_count bigint)
language sql
security definer
set search_path = public
as $$
  select c.id, c.full_name, c.filiere, count(b.id)
  from public.candidates c
  left join public.ballots b on b.candidate_id = c.id
  where public.is_admin()
  group by c.id, c.full_name, c.filiere, c.display_order
  order by c.display_order;
$$;
revoke all on function public.admin_vote_results() from public;
grant execute on function public.admin_vote_results() to authenticated;

-- Accès aux attestations : chaque étudiant peut déposer/voir uniquement son dossier;
-- les administrateurs peuvent consulter les dossiers pour validation.
drop policy if exists "student upload own attestation" on storage.objects;
create policy "student upload own attestation" on storage.objects
for insert to authenticated
with check (bucket_id = 'attestations' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "student read own or admin attestation" on storage.objects;
create policy "student read own or admin attestation" on storage.objects
for select to authenticated
using (bucket_id = 'attestations' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- IMPORTANT : après création du compte organisateur dans Auth, ajouter son UUID :
-- insert into public.admin_users(user_id) values ('UUID_DU_COMPTE_ADMIN');
