"use client";

import { useCallback, useEffect, useState, type ComponentType, type FormEvent } from "react";
import Image from "next/image";
import { clearRouteData, installRouteData } from "./route-data";

type Phase = "checking" | "login" | "loading" | "ready" | "error";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [username, setUsername] = useState("rutaverde");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [RouteApp, setRouteApp] = useState<ComponentType | null>(null);

  const loadPrivateApp = useCallback(async () => {
    setPhase("loading");
    setMessage("");
    const response = await fetch("/api/private-route", { cache: "no-store" });
    if (response.status === 401) {
      clearRouteData();
      setPhase("login");
      return;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || "No fue posible cargar el recorrido protegido.");
    }
    const body = await response.json() as { stops?: unknown };
    installRouteData(body.stops);
    const module = await import("./route-app");
    setRouteApp(() => module.default);
    setPhase("ready");
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/session", { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 503) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error || "La seguridad no está configurada.");
        }
        const body = await response.json() as { authenticated?: boolean };
        if (body.authenticated) await loadPrivateApp();
        else setPhase("login");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "No fue posible comprobar la sesión.");
        setPhase("error");
      });
    return () => { active = false; };
  }, [loadPrivateApp]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPhase("loading");
    setMessage("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "No fue posible iniciar sesión.");
      }
      setPassword("");
      await loadPrivateApp();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible iniciar sesión.");
      setPhase("login");
    }
  };

  const logout = async () => {
    await fetch("/api/session", { method: "DELETE" }).catch(() => {});
    clearRouteData();
    setRouteApp(null);
    setPassword("");
    setPhase("login");
  };

  if (phase === "ready" && RouteApp) {
    return (
      <>
        <button
          type="button"
          onClick={logout}
          style={{ position: "fixed", right: 14, bottom: 14, zIndex: 5000, border: 0, borderRadius: 999, padding: "10px 15px", background: "#173e33", color: "white", fontWeight: 800, boxShadow: "0 8px 24px rgba(0,0,0,.2)" }}
        >
          Cerrar sesión
        </button>
        <RouteApp />
      </>
    );
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "linear-gradient(145deg,#eaf4ee,#f7f4df)" }}>
      <section style={{ width: "min(100%,420px)", padding: 28, borderRadius: 24, background: "rgba(255,255,255,.96)", boxShadow: "0 24px 70px rgba(23,62,51,.18)", border: "1px solid rgba(23,62,51,.1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
          <Image src="/icon-192.png" width={58} height={58} alt="Ruta Verde" priority unoptimized />
          <div><span style={{ display: "block", color: "#587066", fontSize: 12, fontWeight: 800 }}>Acceso protegido</span><strong style={{ color: "#173e33", fontSize: 22 }}>Ruta Verde</strong></div>
        </div>

        {phase === "checking" || phase === "loading" ? (
          <div role="status" style={{ padding: "18px 0", color: "#365c50", fontWeight: 700 }}>Verificando acceso y descifrando el recorrido…</div>
        ) : phase === "error" ? (
          <div><p style={{ color: "#a02d2d", lineHeight: 1.5 }}>{message}</p><button type="button" onClick={() => window.location.reload()} style={{ width: "100%", padding: 13, border: 0, borderRadius: 12, background: "#173e33", color: "white", fontWeight: 800 }}>Reintentar</button></div>
        ) : (
          <form onSubmit={login} style={{ display: "grid", gap: 14 }}>
            <p style={{ margin: 0, color: "#587066", lineHeight: 1.55 }}>Los nombres, direcciones y coordenadas del recorrido están cifrados con AES-256-GCM y solo se cargan después de iniciar sesión.</p>
            <label style={{ display: "grid", gap: 6, color: "#173e33", fontWeight: 800 }}>Usuario<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} style={{ padding: 13, border: "1px solid #bed0c8", borderRadius: 12, font: "inherit" }} /></label>
            <label style={{ display: "grid", gap: 6, color: "#173e33", fontWeight: 800 }}>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} style={{ padding: 13, border: "1px solid #bed0c8", borderRadius: 12, font: "inherit" }} /></label>
            {message && <p role="alert" style={{ margin: 0, color: "#a02d2d", fontWeight: 700 }}>{message}</p>}
            <button type="submit" style={{ padding: 14, border: 0, borderRadius: 12, background: "#173e33", color: "white", fontWeight: 900, fontSize: 15 }}>Entrar a Ruta Verde</button>
          </form>
        )}
      </section>
    </main>
  );
}
