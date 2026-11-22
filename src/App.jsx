import React, { useEffect, useState } from "react";
import { supabase } from "./supabase";

const ADMIN_PATH = "/admin";

const FILIERES = [
  "Chimie",
  "EEA",
  "DAII",
  "TSER",
  "PF",
  "SP",
  "MA",
  "MIAGE",
  "MI",
  "GEO",
  "Autre"
];

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
];

function isAdminRoute() {
  return window.location.pathname.replace(/\/+$/, "") === ADMIN_PATH;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [checking, setChecking] = useState(true);

  const [role, setRole] = useState(null);

  const [page, setPage] = useState(
    isAdminRoute() ? "adminLogin" : "login"
  );

  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [profile, setProfile] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState("");

  const [students, setStudents] = useState([]);
  const [results, setResults] = useState([]);
  const [loadingAdmin, setLoadingAdmin] = useState(false);

  // INITIALISATION DE SUPABASE

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      setChecking(false);
      return;
    }

    let mounted = true;

    async function initialize() {
      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        setMessage(error.message);
      }

      setSession(data?.session || null);
      setAuthReady(true);
    }

    initialize();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!mounted) return;

        setSession(newSession);
        setMessage("");
      }
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // VERIFICATION DU ROLE

  useEffect(() => {
    if (!authReady) return;

    let cancelled = false;

    async function checkAccess() {
      if (!session) {
        setRole(null);
        setProfile(null);
        setStudents([]);
        setResults([]);
        setChecking(false);
        setPage(isAdminRoute() ? "adminLogin" : "login");
        return;
      }

      setChecking(true);

      const { data, error } = await supabase.rpc("is_admin");

      if (cancelled) return;

      if (error) {
        setRole(null);
        setChecking(false);
        setMessage("Erreur de vérification : " + error.message);
        return;
      }

      if (data === true) {
        setRole("admin");

        if (!isAdminRoute()) {
          window.history.replaceState({}, "", ADMIN_PATH);
        }

        setPage("admin");
        await loadAdminData();
      } else {
        setRole("student");

        if (isAdminRoute()) {
          setPage("accessDenied");
        } else {
          await loadStudent(session.user.id);
        }
      }

      if (!cancelled) {
        setChecking(false);
      }
    }

    checkAccess();

    return () => {
      cancelled = true;
    };
  }, [session, authReady]);

  // CONNEXION

  async function signIn(e) {
    e.preventDefault();

    setBusy(true);
    setMessage("");

    const form = new FormData(e.currentTarget);

    const { error } = await supabase.auth.signInWithPassword({
      email: form.get("email"),
      password: form.get("password")
    });

    setBusy(false);

    if (error) {
      setMessage("Connexion impossible : " + error.message);
    } else {
      setMessage("Connexion réussie. Vérification des autorisations...");
    }
  }

  // INSCRIPTION

  async function signUp(e) {
    e.preventDefault();

    setBusy(true);
    setMessage("");

    const form = new FormData(e.currentTarget);
    const file = form.get("attestation");

    if (!(file instanceof File) || file.size === 0) {
      setBusy(false);
      setMessage("Ajoute ton attestation d'inscription L3.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setBusy(false);
      setMessage("Le document ne doit pas dépasser 5 Mo.");
      return;
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      setBusy(false);
      setMessage("Format accepté : JPG, PNG, WEBP ou PDF.");
      return;
    }

    let userId = session?.user?.id;

    if (!userId) {
      const { data, error } = await supabase.auth.signUp({
        email: form.get("email"),
        password: form.get("password")
      });

      if (error) {
        setBusy(false);
        setMessage("Erreur de création du compte : " + error.message);
        return;
      }

      if (!data.user) {
        setBusy(false);
        setMessage("Impossible de créer le compte.");
        return;
      }

      if (!data.session) {
        setBusy(false);
        setMessage(
          "Compte créé. Vérifie ton adresse e-mail, connecte-toi puis complète ton dossier."
        );
        return;
      }

      userId = data.user.id;
    }

    const extension = (
      file.name.split(".").pop() || "jpg"
    ).toLowerCase().replace(/[^a-z0-9]/g, "");

    const path = `${userId}/attestation.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("attestations")
      .upload(path, file, {
        upsert: true,
        contentType: file.type
      });

    if (uploadError) {
      setBusy(false);
      setMessage("Erreur de dépôt : " + uploadError.message);
      return;
    }

    const { error: profileError } = await supabase
      .from("student_profiles")
      .insert({
        user_id: userId,
        full_name: form.get("full_name").trim(),
        matricule: form.get("matricule").trim(),
        filiere: form.get("filiere"),
        attestation_path: path
      });

    setBusy(false);

    if (profileError) {
      setMessage("Erreur d'enregistrement : " + profileError.message);
      return;
    }

    setMessage("Dossier envoyé avec succès.");

    await loadStudent(userId);
  }

  // CHARGEMENT DU PROFIL

  async function loadStudent(userId) {
    const id = userId || session?.user?.id;

    if (!id) return;

    const { data, error } = await supabase
      .from("student_profiles")
      .select("*")
      .eq("user_id", id)
      .maybeSingle();

    if (error) {
      setMessage("Erreur de chargement : " + error.message);
      return;
    }

    setProfile(data);

    if (!data) {
      setPage("register");
      return;
    }

    if (data.status === "pending") {
      setPage("pending");
      return;
    }

    if (data.status === "rejected") {
      setPage("rejected");
      return;
    }

    if (data.status === "approved" && data.has_voted) {
      setPage("done");
      return;
    }

    if (data.status === "approved") {
      const { data: candidateData, error: candidateError } =
        await supabase
          .from("candidates")
          .select("*")
          .order("display_order");

      if (candidateError) {
        setMessage(candidateError.message);
        return;
      }

      setCandidates(candidateData || []);
      setPage("vote");
      return;
    }

    setPage("pending");
  }

  // VOTE

  async function submitVote() {
    if (!selected || busy) {
      setMessage("Sélectionne un candidat.");
      return;
    }

    const confirmed = window.confirm(
      "Confirmer ton choix ? Après confirmation, tu ne pourras plus voter."
    );

    if (!confirmed) return;

    setBusy(true);
    setMessage("");

    const { error } = await supabase.rpc("cast_vote", {
      p_candidate_id: selected
    });

    setBusy(false);

    if (error) {
      setMessage("Erreur de vote : " + error.message);
      return;
    }

    setSelected("");
    setPage("done");
    setMessage("Ton vote a été enregistré avec succès.");
  }

  // DONNEES ADMINISTRATEUR

  async function loadAdminData() {
    setLoadingAdmin(true);

    const { data: studentData, error: studentError } =
      await supabase
        .from("student_profiles")
        .select("*")
        .order("created_at", { ascending: false });

    if (studentError) {
      setMessage("Erreur des étudiants : " + studentError.message);
      setLoadingAdmin(false);
      return;
    }

    setStudents(studentData || []);

    const { data: resultData, error: resultError } =
      await supabase.rpc("admin_vote_results");

    if (resultError) {
      setMessage("Erreur des résultats : " + resultError.message);
    } else {
      setResults(resultData || []);
    }

    setLoadingAdmin(false);
  }

  // APPROBATION ET REFUS

async function changeStudentStatus(userId, status) {
  if (busy) return;

  if (!["approved", "rejected"].includes(status)) {
    setMessage("Statut invalide.");
    return;
  }

  const action = status === "approved" ? "approuver" : "refuser";

  const confirmed = window.confirm(
    `Veux-tu vraiment ${action} cette inscription ?`
  );

  if (!confirmed) return;

  setBusy(true);
  setMessage("");

  const { error } = await supabase.rpc("admin_set_student_status", {
    p_user_id: userId,
    p_status: status
  });

  setBusy(false);

  if (error) {
    setMessage("Erreur de modification : " + error.message);
    return;
  }

  setMessage(
    status === "approved"
      ? "Inscription approuvée avec succès."
      : "Inscription refusée avec succès."
  );

  await loadAdminData();
}
  // DECONNEXION

  async function logout() {
    setBusy(true);

    const { error } = await supabase.auth.signOut();

    setBusy(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setRole(null);
    setProfile(null);
    setStudents([]);
    setResults([]);
    setSelected("");
    setMessage("");
  }

  // CONFIGURATION

  if (!supabase) {
    return (
      <main className="shell">
        <section className="card">
          <h1>Configuration nécessaire</h1>
          <p>Vérifie le fichier .env et la connexion Supabase.</p>
        </section>
      </main>
    );
  }

  if (!authReady || checking) {
    return (
      <main className="shell">
        <section className="card center">
          <h2>Chargement...</h2>
          <p>Vérification de votre accès.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">

      <header className="hero">
        <div className="badge">🎓 ÉLECTION L3</div>

        <h1>
          Président de la cérémonie
          <br />
          de remise des diplômes
        </h1>

        <p>
          Plateforme de vote réservée aux étudiants de la promotion L3.
        </p>
      </header>

      {session && (
        <div className="topline">
          <span>
            {role === "admin" ? "Administrateur" : "Étudiant"} :
            {" "}{session.user.email}
          </span>

          <button className="link" onClick={logout} disabled={busy}>
            Déconnexion
          </button>
        </div>
      )}

      {message && <div className="notice">{message}</div>}

      {/* ESPACE ETUDIANT */}

      {!isAdminRoute() && !session && page === "login" && (
        <section className="card">
          <h2>Connexion étudiant</h2>

          <form onSubmit={signIn}>
            <label>
              Adresse e-mail
              <input name="email" type="email" required />
            </label>

            <label>
              Mot de passe
              <input name="password" type="password" required />
            </label>

            <button disabled={busy}>
              {busy ? "Connexion..." : "Se connecter"}
            </button>
          </form>

          <p className="muted">
            Pas encore de compte ?{" "}
            <button
              className="link"
              onClick={() => {
                setPage("register");
                setMessage("");
              }}
            >
              Déposer une demande d'accès
            </button>
          </p>
        </section>
      )}

      {!isAdminRoute() && page === "register" && (
        <section className="card">
          <h2>Demande d'accès étudiant</h2>

          <p>
            Renseigne tes informations et joins ton attestation L3.
          </p>

          <form onSubmit={signUp}>
            <label>
              Nom et prénom
              <input name="full_name" required maxLength="120" />
            </label>

            <label>
              Numéro matricule
              <input name="matricule" required maxLength="60" />
            </label>

            <label>
              Filière
              <select name="filiere" required defaultValue="">
                <option value="" disabled>Choisir la filière</option>

                {FILIERES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>

            {!session && (
              <>
                <label>
                  Adresse e-mail
                  <input name="email" type="email" required />
                </label>

                <label>
                  Mot de passe
                  <input name="password" type="password" minLength="8" required />
                </label>
              </>
            )}

            <label>
              Attestation d'inscription L3
              <input
                name="attestation"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                required
              />
            </label>

            <p className="muted">
              JPG, PNG, WEBP ou PDF, 5 Mo maximum.
            </p>

            <button disabled={busy}>
              {busy ? "Envoi..." : "Envoyer ma demande"}
            </button>
          </form>

          {!session && (
            <p className="muted">
              <button className="link" onClick={() => setPage("login")}>
                Retour à la connexion
              </button>
            </p>
          )}
        </section>
      )}

      {session && role === "student" && page === "pending" && (
        <section className="card center">
          <h2>Demande en cours de vérification</h2>

          <p>
            Ton dossier a été envoyé. Un organisateur doit vérifier
            ton attestation avant de t'autoriser à voter.
          </p>

          <button
            className="secondary"
            onClick={() => loadStudent(session.user.id)}
          >
            Actualiser le statut
          </button>
        </section>
      )}

      {session && role === "student" && page === "rejected" && (
        <section className="card center">
          <h2>Demande non validée</h2>
          <p>Contacte les organisateurs pour obtenir des informations.</p>
        </section>
      )}

      {session && role === "student" && page === "vote" && (
        <section className="card">
          <h2>Bulletin de vote</h2>
          <p>Choisis un seul candidat.</p>

          <div className="candidate-list">
            {candidates.map((candidate) => (
              <label
                className={`candidate ${
                  selected === candidate.id ? "chosen" : ""
                }`}
                key={candidate.id}
              >
                <input
                  type="radio"
                  name="candidate"
                  value={candidate.id}
                  checked={selected === candidate.id}
                  onChange={() => setSelected(candidate.id)}
                />

                <span>
                  <strong>{candidate.full_name}</strong>
                  <small>{candidate.filiere}</small>
                </span>
              </label>
            ))}
          </div>

          <button
            disabled={!selected || busy}
            onClick={submitVote}
          >
            {busy ? "Enregistrement..." : "Confirmer mon vote"}
          </button>
        </section>
      )}

      {session && role === "student" && page === "done" && (
        <section className="card center">
          <h2>Merci pour ta participation !</h2>
          <p>Ton vote a été enregistré.</p>
        </section>
      )}

      {/* ESPACE ADMINISTRATEUR */}

      {isAdminRoute() && !session && page === "adminLogin" && (
        <section className="card">
          <h2>Administration L3-VOTE</h2>

          <p>Espace réservé aux organisateurs de l'élection.</p>

          <form onSubmit={signIn}>
            <label>
              Adresse e-mail administrateur
              <input name="email" type="email" required />
            </label>

            <label>
              Mot de passe
              <input name="password" type="password" required />
            </label>

            <button disabled={busy}>
              {busy ? "Connexion..." : "Se connecter"}
            </button>
          </form>
        </section>
      )}

      {isAdminRoute() && session && role === "student" && (
        <section className="card center">
          <h2>Accès refusé</h2>

          <p>Ce compte ne possède pas les droits administrateur.</p>

          <button onClick={logout} disabled={busy}>
            Se déconnecter
          </button>
        </section>
      )}

      {/* TABLEAU DE BORD ADMIN */}

      {isAdminRoute() && session && role === "admin" && (
        <section className="admin">

          <div className="card">
            <h2>Tableau de bord administrateur</h2>

            <p>Gestion des inscriptions et résultats électoraux.</p>

            <button
              className="secondary"
              onClick={loadAdminData}
              disabled={loadingAdmin}
            >
              {loadingAdmin ? "Actualisation..." : "Actualiser les données"}
            </button>
          </div>

          <div className="admin-stats">

            <div className="card">
              <h3>Total inscrits</h3>
              <strong>{students.length}</strong>
            </div>

            <div className="card">
              <h3>En attente</h3>
              <strong>
                {students.filter((s) => s.status === "pending").length}
              </strong>
            </div>

            <div className="card">
              <h3>Approuvés</h3>
              <strong>
                {students.filter((s) => s.status === "approved").length}
              </strong>
            </div>

            <div className="card">
              <h3>Ont voté</h3>
              <strong>
                {students.filter((s) => s.has_voted).length}
              </strong>
            </div>

          </div>

          {/* INSCRIPTIONS */}

          <div className="card">
            <h2>Inscriptions étudiantes</h2>

            {loadingAdmin && <p>Chargement...</p>}

            {!loadingAdmin && students.length === 0 && (
              <p>Aucune inscription pour le moment.</p>
            )}

            {students.map((student) => (
              <div className="student-item" key={student.user_id}>
                <h3>{student.full_name}</h3>

                <p>
                  <strong>Matricule :</strong> {student.matricule}
                </p>

                <p>
                  <strong>Filière :</strong> {student.filiere}
                </p>

                <p>
                  <strong>Statut :</strong> {student.status}
                </p>

                <p>
                  <strong>A voté :</strong>{" "}
                  {student.has_voted ? "Oui" : "Non"}
                </p>

                {student.attestation_path && (
                  <button
                    className="secondary"
                    onClick={() => viewAttestation(student.attestation_path)}
                    disabled={busy}
                  >
                    Consulter l'attestation
                  </button>
                )}

                {student.status === "pending" && (
                  <div className="admin-actions">

                    <button
                      disabled={busy}
                      onClick={() =>
                        changeStudentStatus(student.user_id, "approved")
                      }
                    >
                      Approuver
                    </button>

                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        changeStudentStatus(student.user_id, "rejected")
                      }
                    >
                      Refuser
                    </button>

                  </div>
                )}

                <hr />
              </div>
            ))}
          </div>

          {/* RESULTATS */}

          <div className="card">
            <h2>Résultats électoraux</h2>

            <p>Nombre de voix obtenues par chaque candidat.</p>

            {results.length === 0 ? (
              <p>Aucun résultat disponible.</p>
            ) : (
              results.map((result) => (
                <div
                  className="result-item"
                  key={result.candidate_id}
                >
                  <div>
                    <strong>{result.candidate_name}</strong>
                    <small>{result.filiere}</small>
                  </div>

                  <strong>
                    {Number(result.vote_count)} voix
                  </strong>
                </div>
              ))
            )}
          </div>

        </section>
      )}

      <footer>
        Élection de la promotion L3 · Assistance : contacter les organisateurs
      </footer>

    </main>
  );
}