import React, { useEffect, useState } from "react";
import { supabase } from "./supabase";

const STATUS_LABEL = { pending: "En attente", approved: "Validé", rejected: "Refusé" };
const FILTERS = [["pending", "En attente"], ["approved", "Validés"], ["rejected", "Refusés"], ["all", "Tous"]];

export default function Admin() {
  const [tab, setTab] = useState("requests");
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [profiles, setProfiles] = useState([]);
  const [results, setResults] = useState([]);
  const [busyId, setBusyId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadProfiles() {
    setLoading(true);
    const { data, error } = await supabase.from("student_profiles")
      .select("user_id, full_name, matricule, filiere, attestation_path, status, has_voted, created_at")
      .order("created_at", { ascending: true });
    setLoading(false);
    if (error) setMessage(error.message); else setProfiles(data || []);
  }

  async function loadResults() {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_vote_results");
    setLoading(false);
    if (error) setMessage(error.message); else setResults(data || []);
  }

  useEffect(() => { loadProfiles(); loadResults(); }, []);

  async function openAttestation(p) {
    setMessage("");
    const { data, error } = await supabase.storage.from("attestations").createSignedUrl(p.attestation_path, 120);
    if (error) setMessage("Impossible d'ouvrir l'attestation : " + error.message);
    else window.open(data.signedUrl, "_blank", "noopener");
  }

  async function setStatus(p, status) {
    const verb = status === "approved" ? "VALIDER" : "REFUSER";
    if (!window.confirm(`${verb} le dossier de ${p.full_name} (matricule ${p.matricule}) ?\nCette décision est définitive.`)) return;
    setBusyId(p.user_id); setMessage("");
    const { error } = await supabase.rpc("admin_set_student_status", { p_user_id: p.user_id, p_status: status });
    setBusyId("");
    if (error) setMessage(error.message);
    else { setMessage(`Dossier de ${p.full_name} : ${STATUS_LABEL[status].toLowerCase()}.`); loadProfiles(); }
  }

  const count = s => profiles.filter(p => p.status === s).length;
  const voted = profiles.filter(p => p.has_voted).length;
  const q = search.trim().toLowerCase();
  const shown = profiles
    .filter(p => filter === "all" || p.status === filter)
    .filter(p => !q || [p.full_name, p.matricule, p.filiere].some(v => (v || "").toLowerCase().includes(q)));
  const total = results.reduce((s, r) => s + Number(r.vote_count), 0);
  const max = Math.max(1, ...results.map(r => Number(r.vote_count)));

  return <>
    <div className="stats">
      <div><strong>{count("pending")}</strong><span>en attente</span></div>
      <div><strong>{count("approved")}</strong><span>validés</span></div>
      <div><strong>{count("rejected")}</strong><span>refusés</span></div>
      <div><strong>{voted}</strong><span>ont voté</span></div>
    </div>

    <div className="tabs">
      <button className={tab === "requests" ? "" : "secondary"} onClick={() => setTab("requests")}>Demandes d'accès</button>
      <button className={tab === "results" ? "" : "secondary"} onClick={() => { setTab("results"); loadResults(); }}>Résultats</button>
    </div>

    {message && <div className="notice">{message}</div>}

    {tab === "requests" && <section className="card">
      <div className="row">
        <h2>Demandes d'accès</h2>
        <button className="secondary small" onClick={loadProfiles} disabled={loading}>{loading ? "…" : "Actualiser"}</button>
      </div>
      <div className="chips">
        {FILTERS.map(([v, l]) => <button key={v} className={`chip ${filter === v ? "on" : ""}`} onClick={() => setFilter(v)}>
          {l}{v !== "all" ? ` (${count(v)})` : ` (${profiles.length})`}
        </button>)}
      </div>
      <input className="search" placeholder="Rechercher un nom, un matricule, une filière…" value={search} onChange={e => setSearch(e.target.value)} />

      {shown.length === 0 && <p className="muted">Aucun dossier dans cette catégorie.</p>}
      <div className="requests">
        {shown.map(p => <article className="request" key={p.user_id}>
          <div className="req-main">
            <strong>{p.full_name}</strong>
            <small>Matricule {p.matricule} · {p.filiere} · {new Date(p.created_at).toLocaleString("fr-FR")}</small>
            <span className={`pill ${p.status}`}>{STATUS_LABEL[p.status]}{p.has_voted ? " · a voté" : ""}</span>
          </div>
          <div className="req-actions">
            <button className="secondary small" onClick={() => openAttestation(p)}>Voir l'attestation</button>
            {p.status === "pending" && <>
              <button className="small ok" disabled={busyId === p.user_id} onClick={() => setStatus(p, "approved")}>Valider</button>
              <button className="small danger" disabled={busyId === p.user_id} onClick={() => setStatus(p, "rejected")}>Refuser</button>
            </>}
          </div>
        </article>)}
      </div>
      <p className="muted">Avant de valider, vérifie que l'attestation est lisible, au nom de l'étudiant, et que le matricule figure sur la liste officielle de la promotion L3.</p>
    </section>}

    {tab === "results" && <section className="card">
      <div className="row">
        <h2>Résultats</h2>
        <button className="secondary small" onClick={loadResults} disabled={loading}>{loading ? "…" : "Actualiser"}</button>
      </div>
      <p className="muted">{total} bulletin{total > 1 ? "s" : ""} enregistré{total > 1 ? "s" : ""} · {count("approved")} étudiant{count("approved") > 1 ? "s" : ""} autorisé{count("approved") > 1 ? "s" : ""}</p>
      <div className="results">
        {results.map(r => {
          const n = Number(r.vote_count);
          const pct = total ? Math.round((n / total) * 1000) / 10 : 0;
          return <div className="result" key={r.candidate_id}>
            <div className="result-head"><span><strong>{r.candidate_name}</strong> <small>{r.filiere}</small></span><span>{n} · {pct} %</span></div>
            <div className="bar"><div style={{ width: `${(n / max) * 100}%` }} /></div>
          </div>;
        })}
      </div>
    </section>}
  </>;
}
