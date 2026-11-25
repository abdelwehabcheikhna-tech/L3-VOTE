# L3 Vote — Élection du président de la cérémonie

Application web de démonstration : dépôt d'une attestation L3, validation manuelle par un organisateur, puis vote pour un seul candidat.

## Fonctionnement
1. L'étudiant crée un compte avec e-mail et mot de passe.
2. Il fournit nom, matricule, filière et photo/PDF de son attestation L3.
3. Son dossier reste `pending` jusqu'à validation par un administrateur.
4. Après validation, il peut sélectionner un seul candidat.
5. Le serveur enregistre le bulletin sans enregistrer l'identifiant de l'étudiant dans la table `ballots`.
6. Le profil étudiant est marqué comme ayant voté, ce qui bloque une deuxième participation.

## Prérequis
- Node.js LTS installé.
- Un projet Supabase.
- Un compte Vercel pour publier le site.

## Installation locale
Dans le dossier du projet :

```bash
npm install
```

Copier `.env.example` vers `.env` puis renseigner :
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Dans Supabase > SQL Editor, exécuter tout le contenu de `supabase/schema.sql`.

Lancer :
```bash
npm run dev
```
Ouvrir l'adresse locale affichée par Vite.

## Créer le premier administrateur
1. Dans Supabase > Authentication > Users, créer le compte e-mail de l'organisateur.
2. Copier son UUID.
3. Dans SQL Editor, exécuter en remplaçant l'UUID :
```sql
insert into public.admin_users(user_id)
values ('UUID_DU_COMPTE_ADMIN');
```
4. L'administrateur pourra ensuite consulter et valider les dossiers dans Supabase > Table Editor > student_profiles :
   - `pending` = en attente
   - `approved` = autorisé à voter
   - `rejected` = refusé

Pour consulter une attestation, ouvrir Supabase > Storage > attestations et rechercher le dossier correspondant à l'UUID de l'étudiant. Le bucket est privé.

## Résultats
Depuis le SQL Editor, connecté comme administrateur, appeler :
```sql
select * from public.admin_vote_results();
```
Ou depuis une session admin, appeler la fonction RPC `admin_vote_results`.

## Publication sur Internet
1. Pousser le dossier dans un dépôt GitHub privé ou public selon votre choix.
2. Dans Vercel, importer le dépôt.
3. Ajouter les variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans les variables d'environnement.
4. Déployer. Vercel fournira une URL publique à partager.

## Points importants avant une vraie élection
- Ce projet est un prototype technique, pas un système électoral certifié.
- Un scan/photo d'attestation peut être falsifié : un organisateur doit contrôler le document et, idéalement, le matricule auprès de la liste officielle de la promotion.
- Ne demandez pas de données inutiles. Limitez l'accès aux attestations, définissez qui les supprime et quand.
- La séparation identité/bulletin réduit le lien direct entre étudiant et choix, mais ne garantit pas un anonymat cryptographique complet : les journaux, horaires et accès administrateur peuvent créer des corrélations.
- Faites un test avec des comptes fictifs et quelques votes d'essai avant l'ouverture officielle.
- Pour un scrutin sensible, faites auditer la sécurité et adoptez une solution de vote adaptée/certifiée.
