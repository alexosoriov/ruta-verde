"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function AppInstall() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const timer = window.setTimeout(() => setInstalled(standalone), 0);
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setOpen(false); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", onInstalled);
      window.clearTimeout(timer);
    };
  }, []);

  const install = async () => {
    if (!prompt) return setOpen(true);
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setPrompt(null);
  };

  if (installed) return <span className="installed-badge">✓ App instalada</span>;
  return <>
    <button className="install-button" onClick={install} aria-label="Instalar Ruta Verde como aplicación"><span>↓</span> Instalar app</button>
    {open && <div className="install-backdrop" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <div className="install-card">
        <Image src="/logo-ruta-verde.svg" width={74} height={74} alt="" />
        <p>Ruta Verde en tu teléfono</p>
        <h2 id="install-title">Instálala como una app</h2>
        <div className="install-steps">
          <div><b>iPhone · Safari</b><span>1. Toca Compartir □↑</span><span>2. Elige “Agregar a inicio”</span></div>
          <div><b>Android · Chrome</b><span>1. Abre el menú ⋮</span><span>2. Elige “Instalar aplicación”</span></div>
        </div>
        <small>No ocupa casi espacio y conserva la ruta para trabajar sin señal.</small>
        <button onClick={() => setOpen(false)}>Entendido</button>
      </div>
    </div>}
  </>;
}
