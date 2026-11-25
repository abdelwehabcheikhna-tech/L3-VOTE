import React, { useEffect, useState } from "react";
import { supabase } from "./supabase";
import Admin from "./Admin.jsx";

const CANDIDATES = [
  ["Youssef", "Chimie"],
  ["Mouhamed Vall", "EEA"],
  ["Issa Hamza", "DAII"],
  ["El Hassen Sy", "TSER"],
  ["Mohamed", "PF"],
  ["Cheikh", "SP"],
  ["Oumar Mouhamedou", "MA"]
];

const ADMIN_ROUTE = window.location.pathname.replace(/\/+$/, "") === "/admin";

function frenchAuthError(msg) {
  if (/invalid login credentials/i.test(msg)) return "E-mail ou mot de passe incorrect.";
  if (/email not confirmed/i.test(msg)) return "Adresse e-mail non confirmée.";
  if (/already registered/i.test(msg)) return "Un compte existe déjà avec cette adresse e-mail. Connecte-toi.";
  return msg;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [page, setPage] = useState("login");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadStudent();
    else { setProfile(null); setPage("login"); }
  }, [session]);

  async function loadStudent() {
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (isAdmin) { setPage("admin"); return; }
    if (ADMIN_ROUTE) { setPage("not-admin"); return; }
    const { data: p, error } = await supabase.from("student_profiles")
      .select("*").eq("user_id", session.user.id).maybeSingle();
    if (error) { setMessage(error.message); return; }
    setProfile(p);
    if (!p) setPage("register");
    else if (p.status === "pending") setPage("pending");
    else if (p.status === "rejected") setPage("rejected");
    else if (p.has_voted) setPage("done");
    else {
      const { data: cs, error: ce } = await supabase.from("candidates").select("*").order("display_order");
      if (ce) setMessage(ce.message);
      setCandidates(cs || []);
      setPage("vote");
    }
  }

  async function signIn(e) {
    e.preventDefault(); setBusy(true); setMessage("");
    const fd = new FormData(e.currentTarget);
    const { error } = await supabase.auth.signInWithPassword({
      email: fd.get("email"), password: fd.get("password")
    });
    setBusy(false); setMessage(error ? frenchAuthError(error.message) : "Connexion réussie.");
  }

  async function signUp(e) {
    e.preventDefault(); setBusy(true); setMessage("");
    const fd = new FormData(e.currentTarget);
    const email = fd.get("email");
    const password = fd.get("password");
    const file = fd.get("attestation");
    if (!file || !file.size) { setBusy(false); setMessage("Ajoute la photo de ton attestation L3."); return; }
    if (file.size > 5 * 1024 * 1024) { setBusy(false); setMessage("La photo doit faire au maximum 5 Mo."); return; }
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { setBusy(false); setMessage(frenchAuthError(error.message)); return; }
    if (!data.user) { setBusy(false); setMessage("Vérifie ton adresse e-mail puis reconnecte-toi."); return; }
    const uid = data.user.id;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${uid}/attestation.${ext}`;
    const { error: uploadError } = await supabase.storage.from("attestations").upload(path, file, { upsert: true });
    if (uploadError) { setBusy(false); setMessage("Compte créé, mais échec du dépôt du document : " + uploadError.message); return; }
    const { error: profileError } = await supabase.from("student_profiles").insert({
      user_id: uid,
      full_name: fd.get("full_name"),
      matricule: fd.get("matricule"),
      filiere: fd.get("filiere"),
      attestation_path: path
    });
    setBusy(false);
    if (profileError) setMessage("Compte créé, mais erreur du dossier : " + profileError.message);
    else { setMessage("Dossier envoyé. Attends la vérification de l'organisateur."); setPage("pending"); }
  }

  async function submitVote() {
    if (!selected || !window.confirm("Confirmer ton choix ? Après confirmation, le vote ne pourra pas être modifié.")) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.rpc("cast_vote", { p_candidate_id: selected });
    setBusy(false);
    if (error) setMessage(error.message);
    else { setPage("done"); setMessage("Ton vote a été enregistré."); }
  }

  async function logout() { await supabase.auth.signOut(); }

  if (!supabase) return <main className="shell"><section className="card"><h1>Configuration nécessaire</h1><p>Le projet Supabase n'est pas encore configuré. Suis le guide README, exécute le script SQL et renseigne le fichier <code>.env</code>.</p></section></main>;

  return <main className="shell">
    <header className="hero">
      <div className="badge">{page === "admin" || ADMIN_ROUTE ? "🛡️ ESPACE ORGANISATEUR" : "🎓 ÉLECTION L3"}</div>
      <h1>Président de la cérémonie<br/>de remise des diplômes</h1>
      <p>Plateforme de vote réservée aux étudiants de la promotion L3.</p>
    </header>

    {session && <div className="topline"><span>Connecté : {session.user.email}</span><button className="link" onClick={logout}>Déconnexion</button></div>}
    {message && <div className="notice">{message}</div>}

    {!session && page === "login" && ADMIN_ROUTE && <section className="card">
      <h2>Connexion organisateur</h2>
      <p>Espace réservé aux organisateurs de l'élection : validation des demandes d'accès et résultats.</p>
      <form onSubmit={signIn}>
        <label>Adresse e-mail<input name="email" type="email" autoComplete="username" required /></label>
        <label>Mot de passe<input name="password" type="password" autoComplete="current-password" required /></label>
        <button disabled={busy}>{busy ? "Connexion…" : "Accéder à l'espace organisateur"}</button>
      </form>
      <p className="muted"><a href="/">← Retour à l'espace étudiant</a></p>
    </section>}

    {!session && page === "login" && !ADMIN_ROUTE && <section className="card">
      <h2>Connexion étudiant</h2>
      <p>Connecte-toi pour consulter l'état de ton inscription et, après validation, voter.</p>
      <form onSubmit={signIn}>
        <label>Adresse e-mail<input name="email" type="email" autoComplete="username" required /></label>
        <label>Mot de passe<input name="password" type="password" autoComplete="current-password" required /></label>
        <button disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</button>
      </form>
      <p className="muted">Pas encore de compte ? <button className="link" onClick={() => {setPage("register");setMessage("");}}>Déposer une demande d'accès</button></p>
    </section>}

    {session && page === "not-admin" && <section className="card center"><h2>Accès réservé aux organisateurs</h2><p>Le compte {session.user.email} n'a pas les droits d'organisateur.</p><p><a href="/">Aller à l'espace étudiant</a></p></section>}

    {!session && page === "register" && <section className="card">
      <h2>Demande d'accès étudiant</h2>
      <p>Renseigne tes informations et joins une photo lisible de ton attestation d'inscription en L3. L'accès au vote sera ouvert après vérification manuelle.</p>
      <form onSubmit={signUp}>
        <label>Nom et prénom<input name="full_name" required maxLength="120" /></label>
        <label>Numéro matricule<input name="matricule" required maxLength="60" /></label>
        <label>Filière
          <select name="filiere" required defaultValue="">
            <option value="" disabled>Choisir la filière</option>
            {["Chimie","EEA","DAII","TSER","PF","SP","MA","Autre"].map(x=><option key={x}>{x}</option>)}
          </select>
        </label>
        <label>Adresse e-mail<input name="email" type="email" required /></label>
        <label>Mot de passe (8 caractères minimum)<input name="password" type="password" minLength="8" required /></label>
        <label>Photo de l'attestation d'inscription L3<input name="attestation" type="file" accept="image/*,.pdf" required /></label>
        <p className="muted">Formats image ou PDF, 5 Mo maximum. Évite d'envoyer un document contenant des informations non nécessaires.</p>
        <button disabled={busy}>{busy ? "Envoi…" : "Envoyer ma demande"}</button>
      </form>
      <p className="muted"><button className="link" onClick={()=>setPage("login")}>Retour à la connexion</button></p>
    </section>}

    {session && page === "admin" && <Admin />}
    {session && page === "pending" && <section className="card center"><h2>Demande en cours de vérification</h2><p>Ton attestation a été envoyée. Un organisateur doit confirmer que tu appartiens bien à la promotion L3. Tu pourras voter uniquement après validation.</p><button className="secondary" onClick={loadStudent}>Actualiser le statut</button></section>}
    {session && page === "rejected" && <section className="card center"><h2>Demande non validée</h2><p>Ton accès au vote n'a pas été autorisé. Contacte les organisateurs pour connaître la marche à suivre.</p></section>}
    {session && page === "vote" && <section className="card">
      <h2>Bulletin de vote</h2><p>Choisis un seul candidat. Tu ne pourras pas modifier ton choix après confirmation.</p>
      <div className="candidate-list">{candidates.map(c=><label className={`candidate ${selected===c.id?"chosen":""}`} key={c.id}>
        <input type="radio" name="candidate" value={c.id} checked={selected===c.id} onChange={()=>setSelected(c.id)}/>
        <span><strong>{c.full_name}</strong><small>{c.filiere}</small></span>
      </label>)}</div>
      <button disabled={!selected || busy} onClick={submitVote}>{busy ? "Enregistrement…" : "Confirmer mon vote"}</button>
    </section>}
    {session && page === "done" && <section className="card center"><h2>Merci pour ta participation !</h2><p>Le système indique que ton vote a été enregistré. Une deuxième participation est bloquée.</p></section>}
    <footer>Élection de la promotion L3 · Assistance : contacter les organisateurs{!ADMIN_ROUTE && page !== "admin" && <> · <a href="/admin">Espace organisateur</a></>}</footer>
  </main>;
}
