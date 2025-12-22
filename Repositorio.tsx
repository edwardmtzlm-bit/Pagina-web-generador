import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";

type HistoryItem = {
  id: string;
  title: string;
  bodyPreview: string;
  bodyFull: string;
  protected: boolean;
  templateName: string | null;
  createdAt: string;
  pages?: number;
};

const HISTORY_KEY = "hm_pdf_history_v1";

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

const downloadText = (filename: string, text: string) => {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

const downloadJson = (filename: string, data: any) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

function safeLoadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const Repositorio: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [items, setItems] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [onlyProtected, setOnlyProtected] = useState<"all" | "yes" | "no">("all");
  const [templateFilter, setTemplateFilter] = useState<string>("all");
  const [selected, setSelected] = useState<HistoryItem | null>(null);

  // ✅ Carga SIEMPRE que entras a /Repositorio
  useEffect(() => {
    setItems(safeLoadHistory());
  }, [location.pathname]);

  // ✅ Se actualiza si el localStorage cambia (otra pestaña o mismo navegador)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === HISTORY_KEY) setItems(safeLoadHistory());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const templates = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.templateName) set.add(it.templateName);
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return items.filter((it) => {
      if (onlyProtected === "yes" && !it.protected) return false;
      if (onlyProtected === "no" && it.protected) return false;

      if (templateFilter !== "all" && (it.templateName || "") !== templateFilter) return false;

      if (!q) return true;
      const haystack =
        (it.title || "") +
        " " +
        (it.bodyPreview || "") +
        " " +
        (it.templateName || "") +
        " " +
        (it.createdAt || "");
      return haystack.toLowerCase().includes(q);
    });
  }, [items, query, onlyProtected, templateFilter]);

  const stats = useMemo(() => {
    const total = items.length;
    const prot = items.filter((i) => i.protected).length;
    const sin = total - prot;
    return { total, prot, sin };
  }, [items]);

  const clearAll = () => {
    if (!confirm("¿Seguro que quieres borrar TODO el historial de este navegador?")) return;
    localStorage.removeItem(HISTORY_KEY);
    setItems([]);
    setSelected(null);
  };

  const exportAllJson = () => downloadJson(`Repositorio_hm_${Date.now()}.json`, items);

  const reuse = (it: HistoryItem) => navigate("/generador", { state: { fromRepo: it } });

  const exportOneTxt = (it: HistoryItem) => {
    const safeTitle = (it.title || "documento")
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 50);

    const txt =
      `${it.title}\n\n` +
      `Fecha: ${fmtDate(it.createdAt)}\n` +
      `Protección: ${it.protected ? "Sí" : "No"}\n` +
      `Plantilla: ${it.templateName || "—"}\n` +
      `Páginas: ${typeof it.pages === "number" ? it.pages : "—"}\n` +
      `\n========================\n\n` +
      (it.bodyFull || "");

    downloadText(`${safeTitle || "documento"}.txt`, txt);
  };

  return (
    <div className="min-h-screen text-white p-6 bg-gradient-to-b from-[#110020] via-[#050014] to-black">
      <header className="max-w-6xl mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold text-purple-100">Repositorio documental</h1>
            <p className="text-purple-300 text-sm mt-1">
              Guardado local en este navegador (sin nube).
            </p>

            {/* ✅ Debug útil */}
            <p className="text-xs text-purple-200/60 mt-1">
              Registros detectados: <b>{items.length}</b>
            </p>
          </div>

          <Link
            to="/"
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15"
          >
            ← Volver al inicio
          </Link>
        </div>

        <div className="rounded-xl border border-white/15 bg-white/10 p-4 grid grid-cols-1 md:grid-cols-[1fr_180px_260px_auto] gap-3 items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por título, preview, plantilla..."
            className="w-full bg-black/30 border border-white/15 rounded-lg px-3 py-2 outline-none"
          />

          <select
            value={onlyProtected}
            onChange={(e) => setOnlyProtected(e.target.value as any)}
            className="w-full bg-black/30 border border-white/15 rounded-lg px-3 py-2 outline-none"
          >
            <option value="all">Protección: Todas</option>
            <option value="yes">Solo protegidos</option>
            <option value="no">Solo sin protección</option>
          </select>

          <select
            value={templateFilter}
            onChange={(e) => setTemplateFilter(e.target.value)}
            className="w-full bg-black/30 border border-white/15 rounded-lg px-3 py-2 outline-none"
          >
            {templates.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "Plantilla: Todas" : t}
              </option>
            ))}
          </select>

          <div className="flex gap-2 justify-end">
            <button
              onClick={exportAllJson}
              className="px-3 py-2 rounded-lg bg-purple-700 hover:bg-purple-800 text-sm"
            >
              Exportar JSON
            </button>

            <button
              onClick={clearAll}
              className="px-3 py-2 rounded-lg bg-red-700/80 hover:bg-red-800 text-sm"
            >
              Borrar todo
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-sm text-purple-200/90">
          <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10">
            Total: <b>{stats.total}</b>
          </span>
          <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10">
            Protegidos: <b>{stats.prot}</b>
          </span>
          <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10">
            Sin protección: <b>{stats.sin}</b>
          </span>
          <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10">
            Mostrando: <b>{filtered.length}</b>
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto mt-6">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-white/15 bg-white/10 p-8 text-center">
            <p className="text-purple-200/80">
              No hay resultados. Genera documentos o ajusta filtros.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((it) => (
              <div
                key={it.id}
                className="rounded-xl border border-white/15 bg-white/10 p-4 flex items-start justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-purple-100 truncate">{it.title || "Sin título"}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-black/30 border border-white/10">
                      {it.protected ? "Protegido 🔒" : "Sin protección"}
                    </span>
                    {typeof it.pages === "number" && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-black/30 border border-white/10">
                        {it.pages} pág.
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-purple-200/70 mt-1">
                    {fmtDate(it.createdAt)} {it.templateName ? `· ${it.templateName}` : ""}
                  </p>

                  {it.bodyPreview && (
                    <p className="text-sm text-purple-200/90 mt-2">{it.bodyPreview}</p>
                  )}
                </div>

                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => reuse(it)}
                    className="px-3 py-2 rounded-lg bg-purple-700 hover:bg-purple-800 text-xs font-semibold"
                  >
                    Reusar en generador
                  </button>

                  <button
                    onClick={() => setSelected(it)}
                    className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-xs"
                  >
                    Ver detalle
                  </button>

                  <button
                    onClick={() => exportOneTxt(it)}
                    className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-xs"
                  >
                    Exportar TXT
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {selected && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-white/15 bg-[#0b0014] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-purple-100">{selected.title}</h2>
                <p className="text-xs text-purple-200/70 mt-1">
                  {fmtDate(selected.createdAt)} · {selected.protected ? "Protegido 🔒" : "Sin protección"}
                  {selected.templateName ? ` · ${selected.templateName}` : ""}
                  {typeof selected.pages === "number" ? ` · ${selected.pages} pág.` : ""}
                </p>
              </div>

              <button
                onClick={() => setSelected(null)}
                className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-sm"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-black/30 border border-white/10 p-4 max-h-[55vh] overflow-auto whitespace-pre-wrap text-sm text-purple-100/90">
              {selected.bodyFull || "(Sin cuerpo)"}
            </div>

            <div className="mt-4 flex flex-wrap gap-2 justify-end">
              <button
                onClick={() => exportOneTxt(selected)}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15"
              >
                Exportar TXT
              </button>

              <button
                onClick={() => reuse(selected)}
                className="px-4 py-2 rounded-lg bg-purple-700 hover:bg-purple-800 font-semibold"
              >
                Reusar en generador
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Repositorio;
