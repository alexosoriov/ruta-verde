"use client";

import { useEffect, useState } from "react";

const FIELD_STYLE = `
  .map-toolbar strong,.next-card h2,.stop-main strong{font-size:15px!important}
  .map-toolbar small,.next-card p,.stop-main span,.map-caption,.gps-privacy,.notice{font-size:13px!important;line-height:1.45!important}
  .map-buttons button,.map-style-switch button,.map-style-switch a,.primary-action,.complete-action,.absent-action,.quick-settings button,.quick-settings select,.row-nav,.row-actions button,.filters button,.export-button,.add-stop-form button{min-height:48px!important;font-size:13px!important;font-weight:850!important}
  .primary-action,.complete-action,.absent-action{display:flex!important;align-items:center!important;justify-content:center!important}
  .stop-row{min-height:68px!important}
  .status-pill{font-size:11px!important;padding:8px 10px!important}
  .stop-detail label,.add-stop-form label{font-size:11px!important}
  .stop-detail input,.stop-detail select,.add-stop-form input{min-height:46px!important;font-size:14px!important}
  .manager-kpi-grid span,.manager-operational-metrics span,.manager-next span,.activity-row small,.activity-row time{font-size:10px!important}
  .manager-kpi-grid small,.manager-note,.empty-tracking p{font-size:12px!important}
  .activity-row strong{font-size:12px!important}
  .field-gps-guide{position:fixed;left:50%;bottom:58px;z-index:1250;transform:translateX(-50%);width:min(620px,calc(100% - 24px));display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:15px;background:#fff7dc;color:#4d3d12;border:1px solid #e6ca69;box-shadow:0 12px 34px rgba(45,38,12,.2);font-size:13px;font-weight:750;line-height:1.35}
  .field-gps-guide button{flex:0 0 auto;min-width:42px;min-height:42px;border:0;border-radius:10px;background:#173e33;color:white;font-size:18px;cursor:pointer}
  .field-gps-guide.warning{background:#ffe6dd;border-color:#df896c;color:#6d2718}
  @media(max-width:640px){
    .map-toolbar strong,.next-card h2,.stop-main strong{font-size:16px!important}
    .map-toolbar small,.next-card p,.stop-main span,.map-caption,.gps-privacy,.notice{font-size:14px!important}
    .map-buttons button,.map-style-switch button,.map-style-switch a,.primary-action,.complete-action,.absent-action,.quick-settings button,.quick-settings select,.row-nav,.row-actions button,.filters button{min-height:52px!important;font-size:14px!important}
    .field-gps-guide{bottom:66px;align-items:flex-start}
  }
`;

export default function FieldModeSupport() {
  const [message, setMessage] = useState("Para un GPS más estable, mantén la pantalla encendida y desactiva el ahorro de batería durante el recorrido.");
  const [warning, setWarning] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setVisible(false), 12_000);
    void navigator.storage?.persist?.().catch(() => false);

    let hiddenAt: number | null = null;
    let warningTimer: number | null = null;
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (!hiddenAt || Date.now() - hiddenAt < 5_000) return;
      setMessage("La app volvió desde segundo plano. Verifica que el punto azul o el camión siga moviéndose antes de continuar.");
      setWarning(true);
      setVisible(true);
      if (warningTimer !== null) window.clearTimeout(warningTimer);
      warningTimer = window.setTimeout(() => {
        setVisible(false);
        setWarning(false);
      }, 15_000);
      hiddenAt = null;
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(initialTimer);
      if (warningTimer !== null) window.clearTimeout(warningTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    try {
      const mergeNotice = sessionStorage.getItem("ruta-verde-merge-notice");
      if (!mergeNotice) return;
      sessionStorage.removeItem("ruta-verde-merge-notice");
      setMessage(mergeNotice);
      setWarning(false);
      setVisible(true);
      const timer = window.setTimeout(() => setVisible(false), 10_000);
      return () => window.clearTimeout(timer);
    } catch {}
  }, []);

  return <>
    <style>{FIELD_STYLE}</style>
    {visible && <div className={`field-gps-guide ${warning ? "warning" : ""}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" aria-label="Cerrar aviso" onClick={() => setVisible(false)}>×</button>
    </div>}
  </>;
}
