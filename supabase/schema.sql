-- =========================================================
-- L3-VOTE
-- SCHEMA COMPLET SUPABASE
-- =========================================================

-- 1. EXTENSION
create extension if not exists pgcrypto;


-- =========================================================
-- 2. TABLE DES ADMINISTRATEURS
-- =========================================================

create table if not exists public.admin_users (
    user_id uuid primary key
    references auth.users(id)
    on delete cascade
);


-- =========================================================
-- 3. TABLE DES ETUDIANTS
-- =========================================================

create table if not exists public.student_profiles (
    user_id uuid primary key
    references auth.users(id)
    on delete cascade,

    full_name text not null,

    matricule text not null unique,

    filiere text not null,

    attestation_path text not null,

    status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),

    has_voted boolean not null default false,

    created_at timestamptz not null default now()
);


-- =========================================================
-- 4. TABLE DES CANDIDATS
-- =========================================================

create table if not exists public.candidates (
    id uuid primary key default gen_random_uuid(),

    full_name text not null,

    filiere text not null,

    display_order integer not null unique
    check (display_order between 1 and 7)
);


-- =========================================================
-- 5. TABLE DES BULLETINS DE VOTE
-- =========================================================

-- Important :
-- Aucun user_id dans cette table.
-- Le bulletin contient uniquement le candidat choisi.

create table if not exists public.ballots (
    id uuid primary key default gen_random_uuid(),

    candidate_id uuid not null
    references public.candidates(id),

    created_at timestamptz not null default now()
);


-- =========================================================
-- 6. INDEX POUR AMELIORER LES PERFORMANCES
-- =========================================================

create index if not exists idx_student_profiles_status
on public.student_profiles(status);

create index if not exists idx_ballots_candidate
on public.ballots(candidate_id);


-- =========================================================
-- 7. CREATION DU STOCKAGE PRIVE DES ATTESTATIONS
-- =========================================================

insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'attestations',
    'attestations',
    false,
    5242880,
    array[
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf'
    ]
)
on conflict (id)
do update set
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array[
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf'
    ];


-- =========================================================
-- 8. INSERTION DES 7 CANDIDATS
-- =========================================================

insert into public.candidates (
    full_name,
    filiere,
    display_order
)
values
    ('Youssef', 'Chimie', 1),
    ('Mouhamed Vall', 'EEA', 2),
    ('Issa Hamza', 'DAII', 3),
    ('El Hassen Sy', 'TSER', 4),
    ('Mohamed', 'PF', 5),
    ('Cheikh', 'SP', 6),
    ('Oumar Mouhamedou', 'MA', 7)

on conflict (display_order)
do update set
    full_name = excluded.full_name,
    filiere = excluded.filiere;


-- =========================================================
-- 9. ACTIVATION DE LA SECURITE RLS
-- =========================================================

alter table public.admin_users
enable row level security;

alter table public.student_profiles
enable row level security;

alter table public.candidates
enable row level security;

alter table public.ballots
enable row level security;


-- =========================================================
-- 10. FONCTION DE VERIFICATION ADMINISTRATEUR
-- =========================================================

create or replace function public.is_admin()
returns boolean

language sql
stable
security definer

set search_path = public

as $$

    select exists (
        select 1
        from public.admin_users
        where user_id = auth.uid()
    );

$$;

revoke all on function public.is_admin() from public;

grant execute on function public.is_admin()
to authenticated;


-- =========================================================
-- 11. PERMISSIONS DES TABLES
-- =========================================================

grant usage on schema public to authenticated;

grant select, insert, update
on public.student_profiles
to authenticated;

grant select
on public.candidates
to authenticated;

grant select
on public.ballots
to authenticated;


-- =========================================================
-- 12. POLITIQUES DE SECURITE DES ETUDIANTS
-- =========================================================

drop policy if exists "profile insert own"
on public.student_profiles;

create policy "profile insert own"

on public.student_profiles

for insert

to authenticated

with check (
    user_id = auth.uid()
    and status = 'pending'
    and has_voted = false
);


drop policy if exists "profile read own or admin"
on public.student_profiles;

create policy "profile read own or admin"

on public.student_profiles

for select

to authenticated

using (
    user_id = auth.uid()
    or public.is_admin()
);


drop policy if exists "admin update profiles"
on public.student_profiles;

create policy "admin update profiles"

on public.student_profiles

for update

to authenticated

using (
    public.is_admin()
)

with check (
    public.is_admin()
);


-- =========================================================
-- 13. POLITIQUES DES CANDIDATS
-- =========================================================

drop policy if exists "candidates visible"
on public.candidates;

create policy "candidates visible"

on public.candidates

for select

to authenticated

using (true);


-- =========================================================
-- 14. POLITIQUES DES BULLETINS
-- =========================================================

drop policy if exists "admin read ballots"
on public.ballots;

create policy "admin read ballots"

on public.ballots

for select

to authenticated

using (
    public.is_admin()
);


-- Aucun étudiant ne peut insérer directement un bulletin.
-- Les votes passent obligatoirement par cast_vote().


-- =========================================================
-- 15. FONCTION SECURISEE POUR VOTER
-- =========================================================

create or replace function public.cast_vote(
    p_candidate_id uuid
)

returns void

language plpgsql

security definer

set search_path = public

as $$

declare

    v_status text;
    v_has_voted boolean;

begin

    -- Vérifier la connexion

    if auth.uid() is null then

        raise exception
        'Connecte-toi pour voter.';

    end if;


    -- Verrouiller le profil de l'étudiant.
    -- Le verrou empêche deux votes simultanés
    -- pour le même compte.

    select status, has_voted

    into v_status, v_has_voted

    from public.student_profiles

    where user_id = auth.uid()

    for update;


    -- Vérifier l'existence du profil

    if not found then

        raise exception
        'Profil étudiant introuvable.';

    end if;


    -- Vérifier l'approbation

    if v_status <> 'approved' then

        raise exception
        'Ton inscription n'est pas encore approuvée.';

    end if;


    -- Vérifier si l'étudiant a déjà voté

    if v_has_voted then

        raise exception
        'Tu as déjà voté.';

    end if;


    -- Vérifier le candidat

    if not exists (

        select 1

        from public.candidates

        where id = p_candidate_id

    ) then

        raise exception
        'Candidat invalide.';

    end if;


    -- Enregistrer le bulletin sans identité

    insert into public.ballots (
        candidate_id
    )

    values (
        p_candidate_id
    );


    -- Empêcher un nouveau vote

    update public.student_profiles

    set has_voted = true

    where user_id = auth.uid();


end;

$$;


revoke all on function public.cast_vote(uuid)
from public;

grant execute on function public.cast_vote(uuid)
to authenticated;


-- =========================================================
-- 16. FONCTION DES RESULTATS ADMINISTRATEUR
-- =========================================================

create or replace function public.admin_vote_results()

returns table (

    candidate_id uuid,

    candidate_name text,

    filiere text,

    vote_count bigint

)

language sql

security definer

set search_path = public

as $$

    select

        c.id,

        c.full_name,

        c.filiere,

        count(b.id)::bigint

    from public.candidates c

    left join public.ballots b

        on b.candidate_id = c.id

    where public.is_admin()

    group by

        c.id,

        c.full_name,

        c.filiere,

        c.display_order

    order by c.display_order;

$$;


revoke all on function public.admin_vote_results()
from public;

grant execute on function public.admin_vote_results()
to authenticated;


-- =========================================================
-- 17. SECURITE DU STOCKAGE DES ATTESTATIONS
-- =========================================================

drop policy if exists "student upload own attestation"
on storage.objects;

create policy "student upload own attestation"

on storage.objects

for insert

to authenticated

with check (

    bucket_id = 'attestations'

    and (storage.foldername(name))[1] = auth.uid()::text

);


drop policy if exists "student read own or admin attestation"
on storage.objects;

create policy "student read own or admin attestation"

on storage.objects

for select

to authenticated

using (

    bucket_id = 'attestations'

    and (

        (storage.foldername(name))[1] = auth.uid()::text

        or public.is_admin()

    )

);


-- =========================================================
-- 18. FIN DU SCRIPT
-- =========================================================

-- Après création du compte administrateur dans
-- Supabase Authentication, récupérer son UUID.
--
-- Puis exécuter :
--
-- insert into public.admin_users(user_id)
-- values ('UUID_DU_COMPTE_ADMIN');
--
-- NE PAS EXECUTER CETTE COMMANDE AVANT
-- D'AVOIR CREE LE COMPTE ADMINISTRATEUR.
