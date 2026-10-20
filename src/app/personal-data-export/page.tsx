"use client";
import { useEffect, useState } from "react";
import { CardDataExport } from "@/components/card-data-export";
export default function PersonalDataExportPage() {
  const [proof, setProof] = useState("");
  useEffect(() => {
    const capture = () => {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("proof");
      if (value) { setProof(/^e_[A-Za-z0-9_-]{43}$/.test(value) ? value : ""); window.history.replaceState(null, "", window.location.pathname); }
    };
    capture(); window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, []);
  return <main className="auth-shell"><CardDataExport proof={proof} /></main>;
}
