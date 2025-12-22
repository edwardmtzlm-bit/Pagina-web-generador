import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { HistoryItem, loadHistory, saveHistory } from "./history";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { Link, useLocation } from "react-router-dom";

const BACKEND_URL = "https://hm-pdf-backend.onrender.com"; // tu backend en Render

declare global {
  interface Window {
    mammoth: any;
    pdfjsLib: any;
  }
}

type FieldRect = { x: number; y: number; width: number; height: number };

type RemoteTemplate = {
  id: string;
  name: string;
  size: number;
  createdAt: string;
  filename?: string;
};

const HISTORY_KEY = "hm_pdf_history_v1";
const API_BASE =
  (import.meta as any).env?.VITE_BACKEND_URL || BACKEND_URL;
const API_TOKEN = (import.meta as any).env?.VITE_API_TOKEN || "";

/* ============================= */
/* CONFIGURACIONES Y STOPWORDS   */
/* ============================= */

const HEADER_STOPWORDS = [
  "tm",
  "plataforma educativa",
  "horacio marchand",
  "diplomado",
  "aceleración comercial",
  "aceleraci6n comercial",
  "comercial",
  "para impulsar tu negocio",
  "text title",
  "text body",
];

const FOOTER_PATTERNS = [/Página\s+\d+\s+de\s+\d+/i, /Copyright/i];

/** Sanitiza texto SIN tocar saltos de línea */
const sanitize = (t: string) =>
  t.replace(/[^\t\n\r\x20-\x7E\u00A0-\u00FF]/g, "?");

/**
 * Para título: parte el texto en líneas que quepan en un ancho.
 */
function wrapAndConsume(
  text: string,
  font: any,
  size: number,
  maxWidth: number,
  maxLines: number
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";

  const width = (s: string) => font.widthOfTextAtSize(s, size);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const test = cur ? `${cur} ${word}` : word;

    if (width(test) <= maxWidth) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      else lines.push(word);
      cur = word;
      if (lines.length === maxLines) break;
    }
  }

  if (lines.length < maxLines && cur) lines.push(cur);

  const consumed = lines.join(" ");
  const rest = text.slice(consumed.length).trimStart();

  return { lines, rest };
}

const isStopwordLine = (s: string) =>
  HEADER_STOPWORDS.some((w) => s.trim().toLowerCase() === w);

/**
 * Toma el texto plano y saca:
 *  - title: primera línea "útil"
 *  - body: resto del texto
 */
const extractTitleAndBody = (raw: string) => {
  const cleaned = raw
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);

  // líneas que NO deben ser título
  const badTitle = (l: string) => {
    const s = l.trim();
    const low = s.toLowerCase();

    if (!s) return true;
    if (s.length < 3) return true;
    if (s.length > 180) return true;
    if (FOOTER_PATTERNS.some((rx) => rx.test(s))) return true;
    if (isStopwordLine(s)) return true;

    // cosas típicas de plantillas / OCR
    if (/(p(á|a)gina)\s*\d+\s*(de)?\s*\d+/i.test(s)) return true;
    if (/plataforma educativa|horacio marchand|diplomado/i.test(low)) return true;
    if (/copyright/i.test(low)) return true;

    return false;
  };

  const titleIndex = lines.findIndex((l) => !badTitle(l));
  if (titleIndex === -1) return { title: "Sin título", body: cleaned };

  let title = lines[titleIndex];
  if (title.length > 140) title = title.slice(0, 140) + "…";

  const body = lines.slice(titleIndex + 1).join("\n").trim();
  return { title, body };
};

/* ====================== HELPERS UI ====================== */

const fmtDate = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
};

const short = (t: string, n: number) => (t.length > n ? t.slice(0, n) + "…" : t);

/* ============================= */
/* COMPONENTE PRINCIPAL          */
/* ============================= */

const Generador: React.FC = () => {
  const location = useLocation();

  // Estados vacíos para usar placeholder
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [cleanTemplateBytes, setCleanTemplateBytes] = useState<Uint8Array | null>(
    null
  );

  // Info de plantilla
  const [templateName, setTemplateName] = useState<string | null>(null);

  // Campos de formulario
  const [detectedFields, setDetectedFields] = useState<string[] | null>(null);
  const [fieldRects, setFieldRects] = useState<Record<string, FieldRect>>({});
  const [titleFieldName, setTitleFieldName] = useState("");
  const [bodyFieldName, setBodyFieldName] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [generatedPdfBytes, setGeneratedPdfBytes] = useState<Uint8Array | null>(
    null
  );
  const [generatedPages, setGeneratedPages] = useState<number | null>(null);

  const [pdfReady, setPdfReady] = useState(false);

  // 🔒 checkbox para proteger el PDF
  const [protectPdf, setProtectPdf] = useState(false);

  // 📚 Historial local (compartido con /Repositorio)
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // 📂 Plantillas remotas (backend)
  const [remoteTemplates, setRemoteTemplates] = useState<RemoteTemplate[]>([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [selectedRemoteId, setSelectedRemoteId] = useState<string | null>(null);

  const contentFileInputRef = useRef<HTMLInputElement>(null);

  // Carga historial al iniciar
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Carga plantillas remotas si hay token configurado
  const refreshRemoteTemplates = useCallback(async () => {
    if (!API_TOKEN) return;
    setRemoteBusy(true);
    try {
      const resp = await fetch(`${API_BASE}/api/templates`, {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      });
      if (!resp.ok) throw new Error(`API respondió ${resp.status}`);
      const data = (await resp.json()) as RemoteTemplate[];
      setRemoteTemplates(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("No se pudieron cargar plantillas remotas", e);
    } finally {
      setRemoteBusy(false);
    }
  }, []);

  useEffect(() => {
    refreshRemoteTemplates();
  }, [refreshRemoteTemplates]);

  // Persistencia única (estado + localStorage)
  const persistHistory = (items: HistoryItem[]) => {
    setHistory(items);
    saveHistory(items); // <- aquí se guarda en localStorage dentro de ./history
  };

  // Cuando vienes desde Repositorio con "Reusar"
  useEffect(() => {
    const st: any = location.state;

    if (st?.fromRepo?.id) {
      const it: HistoryItem = st.fromRepo;

      setTitle(it.title || "");
      setBody(it.bodyFull || "");
      setProtectPdf(!!it.protected);

      setSuccessMsg("Documento cargado desde Repositorio. Solo genera de nuevo.");
      setTimeout(() => setSuccessMsg(null), 3000);

      // Limpia el state para que no se re-aplique al refrescar
      window.history.replaceState({}, document.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearHistory = () => {
    persistHistory([]);
    setSuccessMsg("Historial limpiado.");
    setTimeout(() => setSuccessMsg(null), 2500);
  };

  const reuseFromHistory = (item: HistoryItem) => {
    setTitle(item.title || "");
    setBody(item.bodyFull || "");
    setProtectPdf(!!item.protected);
    setSuccessMsg("Listo: se cargó el documento desde historial. Solo genera de nuevo.");
    setTimeout(() => setSuccessMsg(null), 3500);
  };


  /* ====================== PDF.JS READY ====================== */

  useEffect(() => {
    const t = setInterval(() => {
      if (window.pdfjsLib) {
        try {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
          setPdfReady(true);
          clearInterval(t);
        } catch {
          setError("No se pudo inicializar PDF.js");
          clearInterval(t);
        }
      }
    }, 150);
    return () => clearInterval(t);
  }, []);

  /* ========================================================= */
  /*    1. CARGAR PLANTILLA PDF                                */
  /* ========================================================= */

  const analyzeTemplateBytes = useCallback(
    async (bytes: ArrayBuffer | Uint8Array, name: string) => {
      setError(null);
      setSuccessMsg(null);
      setGeneratedPdfBytes(null);
      setGeneratedPages(null);
      setDetectedFields(null);
      setFieldRects({});
      setTitleFieldName("");
      setBodyFieldName("");
      setTemplateName(name);
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      try {
        const pdfDoc = await PDFDocument.load(data, { ignoreEncryption: true });

        let names: string[] = [];
        const rects: Record<string, FieldRect> = {};

        // 1) pdf-lib
      try {
        const form = pdfDoc.getForm();
        const fields = form.getFields();
        names = fields.map((f) => f.getName());

        for (const field of fields) {
          // @ts-ignore
          const widgets = (field as any).acroField.getWidgets?.() || [];
          if (widgets.length > 0) {
            // @ts-ignore
            const r = widgets[0].getRectangle();
            rects[field.getName()] = r;
          }
        }
      } catch (e) {
        console.warn("No se pudieron leer campos con pdf-lib", e);
        names = [];
        }

      // 2) Fallback pdf.js
      if (names.length === 0 && window.pdfjsLib) {
        try {
          const pdfjs = await window.pdfjsLib.getDocument({ data }).promise;
          const anyPdf: any = pdfjs;

          let fieldObjs: any = null;
          if (typeof anyPdf.getFieldObjects === "function") {
            fieldObjs = await anyPdf.getFieldObjects();
          }

          if (fieldObjs) {
            for (const [fieldName, entries] of Object.entries(fieldObjs)) {
              names.push(fieldName);
              const w: any = (entries as any[])[0];
              if (w?.rect?.length === 4) {
                const [x1, y1, x2, y2] = w.rect;
                rects[fieldName] = {
                  x: Math.min(x1, x2),
                  y: Math.min(y1, y2),
                  width: Math.abs(x2 - x1),
                  height: Math.abs(y2 - y1),
                };
              }
            }
          }
        } catch (e) {
          console.warn("No se pudieron leer campos con pdf.js", e);
        }
      }

      if (names.length > 0) {
        setDetectedFields(names);
        setFieldRects(rects);

        const lowerNames = names.map((n) => n.toLowerCase());
        const titleIdx = lowerNames.findIndex((n) => n.includes("title"));
        const bodyIdx = lowerNames.findIndex((n) => n.includes("body"));

        const resolvedTitle = titleIdx >= 0 ? names[titleIdx] : names[0];

        let resolvedBody = "";
        if (bodyIdx >= 0 && names[bodyIdx] !== resolvedTitle) {
          resolvedBody = names[bodyIdx];
        } else {
          const other = names.find((n) => n !== resolvedTitle);
          resolvedBody = other ?? "";
        }

        setTitleFieldName(resolvedTitle);
        setBodyFieldName(resolvedBody);
      } else {
        setDetectedFields(null);
      }

      // copia limpia
      const clean = await PDFDocument.create();
      const pages = await clean.copyPages(pdfDoc, pdfDoc.getPageIndices());
      pages.forEach((p) => clean.addPage(p));
      const cleanBytes = await clean.save();

      setCleanTemplateBytes(cleanBytes);
      setSuccessMsg("Plantilla cargada correctamente.");
      setTimeout(() => setSuccessMsg(null), 2500);
    } catch (e) {
      console.error(e);
      setError("No se pudo analizar la plantilla.");
      throw e;
    }
    },
    []
  );

  const handleTemplateChange = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    try {
      const bytes = await file.arrayBuffer();
      await analyzeTemplateBytes(bytes, file.name);
    } finally {
      ev.target.value = "";
    }
  };

  /* ========================================================= */
  /*    2. CARGAR CONTENIDO (TXT/DOCX/PDF)                     */
  /* ========================================================= */

  const handleRemoteUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (!API_TOKEN) {
      setError("Configura VITE_API_TOKEN para subir plantillas al backend.");
      ev.target.value = "";
      return;
    }
    setRemoteBusy(true);
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      fd.append("nombre", file.name.replace(/\.pdf$/i, ""));
      const resp = await fetch(`${API_BASE}/api/templates`, {
        method: "POST",
        headers: { Authorization: `Bearer ${API_TOKEN}` },
        body: fd,
      });
      if (!resp.ok) throw new Error(`Backend respondió ${resp.status}`);
      await refreshRemoteTemplates();
      setSuccessMsg("Plantilla subida al backend.");
      setTimeout(() => setSuccessMsg(null), 2500);
    } catch (e: any) {
      setError(e.message || "No se pudo subir la plantilla.");
    } finally {
      ev.target.value = "";
      setRemoteBusy(false);
    }
  };

  const handleSelectRemote = async (id: string | null) => {
    if (!id) {
      setSelectedRemoteId(null);
      setTemplateName(null);
      setCleanTemplateBytes(null);
      return;
    }
    if (!API_TOKEN) {
      setError("Configura VITE_API_TOKEN para usar plantillas del backend.");
      return;
    }
    setRemoteBusy(true);
    try {
      const resp = await fetch(`${API_BASE}/api/templates/${id}/download`, {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      });
      if (!resp.ok) throw new Error(`Backend respondió ${resp.status}`);
      const buf = await resp.arrayBuffer();
      setSelectedRemoteId(id);
      await analyzeTemplateBytes(buf, remoteTemplates.find((t) => t.id === id)?.name || "Plantilla");
    } catch (e: any) {
      setError(e.message || "No se pudo cargar la plantilla remota.");
    } finally {
      setRemoteBusy(false);
    }
  };

  const handleDeleteRemote = async (id: string) => {
    if (!API_TOKEN) {
      setError("Configura VITE_API_TOKEN para borrar plantillas del backend.");
      return;
    }
    setRemoteBusy(true);
    try {
      await fetch(`${API_BASE}/api/templates/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      });
      await refreshRemoteTemplates();
      if (selectedRemoteId === id) {
        setSelectedRemoteId(null);
        setTemplateName(null);
        setCleanTemplateBytes(null);
      }
    } catch (e) {
      console.error("No se pudo borrar plantilla remota", e);
    } finally {
      setRemoteBusy(false);
    }
  };

  const parseTxtToText = async (file: File) => file.text();

  const parseDocxToText = async (ab: ArrayBuffer) => {
    const res = await window.mammoth.extractRawText({ arrayBuffer: ab });
    return res.value.replace(/\u0000/g, "").replace(/\n{3,}/g, "\n\n").trim();
  };

  const parsePdfToText = async (file: File) => {
    if (!window.pdfjsLib) throw new Error("pdf.js no cargado");

    const ab = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: ab }).promise;

    const pagesLines: string[][] = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent({ normalizeWhitespace: true });

      const H = viewport.height;

      // Bandas a ignorar (más agresivas que antes)
      const headerCut = H - 140; // ignora más arriba
      const footerCut = 90; // ignora más abajo

      // Agrupar por renglón (Y)
      const rows: Record<number, { y: number; chunks: { x: number; s: string }[] }> = {};

      tc.items.forEach((it: any) => {
        const s = (it.str || "").replace(/\s+/g, " ").trim();
        if (!s) return;

        const [, , , , x, y] = it.transform;

        // Filtra header/footer por posición
        if (y >= headerCut) return;
        if (y <= footerCut) return;

        const yKey = Math.round(y);
        rows[yKey] ??= { y, chunks: [] };
        rows[yKey].chunks.push({ x, s });
      });

      const sortedY = Object.keys(rows).map(Number).sort((a, b) => b - a);

      const lines = sortedY
        .map((k) =>
          rows[k].chunks
            .sort((a, b) => a.x - b.x)
            .map((c) => c.s)
            .join(" ")
            .trim()
        )
        .filter((ln) => {
          if (!ln) return false;
          if (FOOTER_PATTERNS.some((rx) => rx.test(ln))) return false;
          if (isStopwordLine(ln)) return false;
          return true;
        });

      pagesLines.push(lines);
    }

    // ===== FILTRO: remover líneas repetidas entre páginas (plantilla/OCR) =====
    const freq = new Map<string, number>();
    for (const lines of pagesLines) {
      const uniq = new Set(lines.map((l) => l.toLowerCase()));
      for (const l of uniq) freq.set(l, (freq.get(l) || 0) + 1);
    }

    // Si una línea aparece en >= 40% de páginas, probablemente es plantilla
    const threshold = Math.max(2, Math.ceil(pdf.numPages * 0.4));

    const finalLines: string[] = [];
    for (const lines of pagesLines) {
      for (const ln of lines) {
        const key = ln.toLowerCase();
        if ((freq.get(key) || 0) >= threshold) continue; // quita repetidas
        finalLines.push(ln);
      }
      finalLines.push(""); // separador de página
    }

    let text = finalLines.join("\n");
    text = text.replace(/-\n(?=[a-záéíóúñ])/gi, ""); // quita corte por guion
    text = text.replace(/\n{3,}/g, "\n\n").trim();

    return text;
  };

  const handleContentFileChange = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    try {
      setError(null);
      setSuccessMsg(null);

      const name = file.name.toLowerCase();
      let raw = "";

      if (name.endsWith(".txt")) raw = await parseTxtToText(file);
      else if (name.endsWith(".docx"))
        raw = await parseDocxToText(await file.arrayBuffer());
      else if (name.endsWith(".pdf")) raw = await parsePdfToText(file);
      else {
        setError("Formato no soportado.");
        return;
      }

      const { title, body } = extractTitleAndBody(raw);
      setTitle(title);
      setBody(body);
      setSuccessMsg("Contenido cargado correctamente.");
      setTimeout(() => setSuccessMsg(null), 2500);
    } catch (e: any) {
      setError(`Error al extraer texto: ${e.message}`);
    } finally {
      ev.target.value = "";
    }
  };

  /* ====================== HELPER CUERPO ====================== */

  const normalizeBody = (t: string) =>
    t.replace(/\r/g, "").replace(/\u2028|\u2029/g, "\n"); // separadores raros → \n

  /* ========================================================= */
  /*    3. GENERAR PDF                                         */
  /* ========================================================= */

  const generatePdf = useCallback(async () => {
    if (!cleanTemplateBytes) {
      setError("Sube primero una plantilla PDF.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);
    setGeneratedPdfBytes(null);
    setGeneratedPages(null);

    try {
      const pdfDoc = await PDFDocument.load(cleanTemplateBytes);
      const srcTemplate = await PDFDocument.load(cleanTemplateBytes);

      const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const p0 = pdfDoc.getPage(0);
      const { width, height } = p0.getSize();

      const PAD = 5;
      const FONT_TITLE = 14;
      const LINE_H_TITLE = 16;
      const FONT_BODY = 11;
      const LINE_H = 14;

      // Campos
      const hasTitleField =
        detectedFields &&
        detectedFields.length > 0 &&
        titleFieldName &&
        fieldRects[titleFieldName];

      const hasBodyField =
        detectedFields &&
        detectedFields.length > 1 &&
        bodyFieldName &&
        bodyFieldName !== titleFieldName &&
        fieldRects[bodyFieldName];

      const usingFormFields = !!(
        (hasTitleField || hasBodyField) &&
        detectedFields &&
        detectedFields.length > 0
      );

      const isPlantilla3 =
        templateName && templateName.toLowerCase().includes("plantilla3");

      // ========= MÁRGENES ADAPTATIVOS =========
      let marginX: number;
      let bottomMargin: number;
      let topMarginFirst: number;
      let topBandFlow: number;

      if (usingFormFields) {
        marginX = 72;
        bottomMargin = 72;
        topMarginFirst = 140;
        topBandFlow = 72;
      } else {
        marginX = 48;
        bottomMargin = 96;
        topMarginFirst = isPlantilla3 ? 110 : 80;
        topBandFlow = 80;
      }

      // Rect título
      let titleRect: FieldRect;
      if (hasTitleField) {
        titleRect = fieldRects[titleFieldName];
      } else {
        titleRect = {
          x: marginX,
          y: height - topMarginFirst,
          width: width - marginX * 2,
          height: 32,
        };
      }

      // Rect cuerpo primera página
      let bodyRectFirst: FieldRect;
      if (hasBodyField) {
        bodyRectFirst = fieldRects[bodyFieldName];
      } else {
        const usableHeight = titleRect.y - 16 - bottomMargin;
        bodyRectFirst = {
          x: marginX,
          y: bottomMargin,
          width: width - marginX * 2,
          height: Math.max(usableHeight, LINE_H * 4),
        };
      }

      // Rect flujo genérico (solo se usa si NO hay bodyField)
      const flowRect: FieldRect = {
        x: marginX,
        y: bottomMargin,
        width: width - marginX * 2,
        height: height - bottomMargin - topBandFlow,
      };

      let flowRectWithTitle: FieldRect | null = null;
      if (hasBodyField) {
        const extraHeight = titleRect.height + 8;
        flowRectWithTitle = {
          x: bodyRectFirst.x,
          y: bodyRectFirst.y,
          width: bodyRectFirst.width,
          height: bodyRectFirst.height + extraHeight,
        };
      }

      const rectForPage = (pageIndex: number): FieldRect => {
        if (hasBodyField) {
          if (pageIndex === 0) return bodyRectFirst;
          return flowRectWithTitle ?? bodyRectFirst;
        }
        return pageIndex === 0 ? bodyRectFirst : flowRect;
      };

      // Limpia SOLO título si no hay campos (para quitar texto demo de la plantilla)
      if (!usingFormFields) {
        p0.drawRectangle({
          x: titleRect.x,
          y: titleRect.y,
          width: titleRect.width,
          height: titleRect.height,
          color: rgb(1, 1, 1),
        });
      }

      /* ===== TÍTULO ===== */
      const titleMaxW = titleRect.width - PAD * 2;
      const { lines: tLines } = wrapAndConsume(
        sanitize(title || "Sin título"),
        titleFont,
        FONT_TITLE,
        titleMaxW,
        Math.max(1, Math.floor(titleRect.height / LINE_H_TITLE))
      );

      let ty = titleRect.y + titleRect.height - PAD - FONT_TITLE;
      tLines.forEach((line) => {
        p0.drawText(line, {
          x: titleRect.x + PAD,
          y: ty,
          font: titleFont,
          size: FONT_TITLE,
          color: rgb(0, 0, 0),
        });
        ty -= LINE_H_TITLE;
      });

      /* ===== CUERPO ===== */

      const rawBody = normalizeBody(body);

      const blocks = rawBody
        .split(/\n{2,}/)
        .map((b) => b.replace(/\s+$/g, ""))
        .filter((b) => b.trim().length > 0);

      let currentPage = p0;
      let currentRect = rectForPage(0);
      let currentY = currentRect.y + currentRect.height - PAD - FONT_BODY;

      const ensureNewPage = async () => {
        const [tpl] = await pdfDoc.copyPages(srcTemplate, [0]);
        const page = pdfDoc.addPage(tpl);
        const idx = pdfDoc.getPageCount() - 1;
        const rect = rectForPage(idx);

        currentPage = page;
        currentRect = rect;
        currentY = currentRect.y + currentRect.height - PAD - FONT_BODY;
      };

      const lineTooLow = () => currentY < currentRect.y + PAD + FONT_BODY;

      for (let bi = 0; bi < blocks.length; bi++) {
        const block = blocks[bi];
        const logicalLines = block.split("\n");

        for (let li = 0; li < logicalLines.length; li++) {
          const logical = logicalLines[li];

          if (logical.trim() === "") {
            if (lineTooLow()) await ensureNewPage();
            currentY -= LINE_H;
            continue;
          }

          const words = logical.split(/\s+/).filter((w) => w.length > 0);
          let curLine = "";
          const maxWidth = currentRect.width - PAD * 2;

          for (let wi = 0; wi < words.length; wi++) {
            const word = words[wi];
            const test = curLine ? `${curLine} ${word}` : word;

            if (bodyFont.widthOfTextAtSize(test, FONT_BODY) <= maxWidth) {
              curLine = test;
            } else {
              if (lineTooLow()) await ensureNewPage();
              if (curLine) {
                currentPage.drawText(sanitize(curLine), {
                  x: currentRect.x + PAD,
                  y: currentY,
                  font: bodyFont,
                  size: FONT_BODY,
                  color: rgb(0, 0, 0),
                });
                currentY -= LINE_H;
              }
              curLine = word;
            }
          }

          if (curLine) {
            if (lineTooLow()) await ensureNewPage();
            currentPage.drawText(sanitize(curLine), {
              x: currentRect.x + PAD,
              y: currentY,
              font: bodyFont,
              size: FONT_BODY,
              color: rgb(0, 0, 0),
            });
            currentY -= LINE_H;
          }
        }

        if (bi < blocks.length - 1) {
          if (lineTooLow()) await ensureNewPage();
          currentY -= LINE_H;
        }
      }

      /* ===== PAGINACIÓN ===== */
      const totalBeforeSave = pdfDoc.getPageCount();
      if (totalBeforeSave > 1) {
        const fontSmall = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const footerY = usingFormFields ? 44 : 72;

        for (let i = 0; i < totalBeforeSave; i++) {
          const pg = pdfDoc.getPage(i);
          pg.drawText(`Página ${i + 1} de ${totalBeforeSave}`, {
            x: pg.getWidth() - 120,
            y: footerY,
            font: fontSmall,
            size: 9,
            color: rgb(0.35, 0.35, 0.35),
          });
        }
      }

      const out = await pdfDoc.save();

      // Páginas finales (variable local, confiable para historial)
      let pagesCount = totalBeforeSave;
      try {
        const verify = await PDFDocument.load(out);
        pagesCount = verify.getPageCount();
      } catch {
        // deja totalBeforeSave
      }
      setGeneratedPages(pagesCount);

      // Sin protección
      if (!protectPdf) {
        setGeneratedPdfBytes(out);
        setSuccessMsg("PDF generado correctamente.");
      } else {
        // Con protección
        const fileName =
          title.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40) || "documento";

        // ✅ FIX TS: convertir a ArrayBuffer “normal” para File/BlobPart
        const outArrayBuffer = out.slice().buffer;

        const file = new File([outArrayBuffer], `${fileName}.pdf`, {
          type: "application/pdf",
        });

        const formData = new FormData();
        formData.append("archivo", file);

        const resp = await fetch(`${BACKEND_URL}/proteger-pdf`, {
          method: "POST",
          body: formData,
        });

        if (!resp.ok) throw new Error(`Backend respondió ${resp.status}`);

        const blob = await resp.blob();
        const buf = await blob.arrayBuffer();
        const protectedBytes = new Uint8Array(buf);

        setGeneratedPdfBytes(protectedBytes);
        setSuccessMsg("PDF generado y protegido correctamente.");
      }

      // ===== Guardar en historial local =====
      const bodyNormalized = normalizeBody(body || "");
      const bodyClipped = bodyNormalized.slice(0, 20000);
      const bodyPreview = short(bodyClipped.replace(/\s+/g, " ").trim(), 160);

      const id =
        (globalThis.crypto as any)?.randomUUID?.()
          ? (globalThis.crypto as any).randomUUID()
          : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

      const item: HistoryItem = {
        id,
        title: title || "Sin título",
        bodyPreview,
        bodyFull: bodyClipped,
        protected: protectPdf,
        templateName: templateName || null,
        createdAt: new Date().toISOString(),
        pages: pagesCount,
      };

      const updated = [item, ...history].slice(0, 20);

      localStorage.setItem("hm_pdf_history_v1", JSON.stringify(updated));

      persistHistory(updated);

      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (e: any) {
      setError("Error al generar: " + e.message);
    } finally {
      setIsLoading(false);
    }
  }, [
    cleanTemplateBytes,
    title,
    body,
    detectedFields,
    fieldRects,
    titleFieldName,
    bodyFieldName,
    templateName,
    protectPdf,
    history,
  ]);

  /* ========================================================= */
  /*    DESCARGAR PDF                                          */
  /* ========================================================= */

  const downloadPdf = () => {
    if (!generatedPdfBytes) return;

    // ✅ FIX TS: pasar ArrayBuffer “normal” al Blob
    const blob = new Blob([generatedPdfBytes.slice().buffer], { type: "application/pdf" });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);

    const safeName = (title || "documento")
      .toLowerCase()
      .replace(/\s+/g, "_")
      .slice(0, 50);
    a.download = safeName + ".pdf";

    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ====================== PANEL RESUMEN ====================== */

  const summary = useMemo(() => {
    const hasTemplate = !!cleanTemplateBytes;
    const hasContent = (title || "").trim().length > 0 || (body || "").trim().length > 0;
    const fieldsDetected = detectedFields?.length ? detectedFields.length : 0;

    return {
      hasTemplate,
      hasContent,
      fieldsDetected,
      protected: protectPdf,
      pages: generatedPages,
      templateName: templateName,
    };
  }, [cleanTemplateBytes, title, body, detectedFields, protectPdf, generatedPages, templateName]);

  /* ========================================================= */
  /*                      INTERFAZ UI                           */
  /* ========================================================= */

  return (
    <div className="min-h-screen text-white p-6 bg-gradient-to-b from-[#110020] via-[#050014] to-black">
      {/* Header Pro light */}
      <header className="flex flex-col items-center mb-8">
        <h1 className="text-4xl font-extrabold text-center text-purple-100">
          Generador de Documentos
        </h1>
        <p className="mt-2 text-sm text-purple-300 uppercase tracking-[0.25em]">
          Plataforma Educativa Horacio Marchand
        </p>
        <Link
  to="/"
  className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 border border-white/20 hover:bg-white/15 text-sm"
>
  ← Volver al inicio
</Link>

      </header>

      {/* Layout Pro: 2 columnas en escritorio */}
      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* Columna izquierda: flujo */}
        <div className="space-y-6">
          {/* Mensajes */}
          {(error || successMsg) && (
            <div className="rounded-xl border border-white/15 bg-white/10 p-4">
              {error && <p className="text-red-300 text-sm">{error}</p>}
              {successMsg && <p className="text-green-200 text-sm">{successMsg}</p>}
            </div>
          )}

          {/* 1. PLANTILLA */}
          <section className="bg-white/10 p-6 rounded-xl border border-white/20 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-purple-300">1. Plantilla</h2>
              <span className="text-xs text-purple-200/80">
                {summary.hasTemplate ? "✅ Cargada" : "⏳ Pendiente"}
              </span>
            </div>

            <input
              type="file"
              accept=".pdf"
              onChange={handleTemplateChange}
              className="block w-full text-purple-200 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-purple-200 file:text-purple-900"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-purple-200">Plantillas en backend</label>
                {API_TOKEN ? (
                  <>
                    <select
                      className="w-full bg-white/20 rounded-md px-3 py-2"
                      value={selectedRemoteId ?? ""}
                      onChange={(e) => handleSelectRemote(e.target.value || null)}
                      disabled={remoteBusy}
                    >
                      <option value="">(Sin plantilla remota)</option>
                      {remoteTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({(t.size / 1024 / 1024).toFixed(1)} MB)
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <label className="flex-1 text-xs text-purple-200/80">
                        {remoteBusy ? "Sincronizando..." : "Sincroniza al cargar la página"}
                      </label>
                      {selectedRemoteId && (
                        <button
                          onClick={() => handleDeleteRemote(selectedRemoteId)}
                          disabled={remoteBusy}
                          className="text-xs text-red-200 underline"
                        >
                          Borrar
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-red-200">
                    Configura VITE_API_TOKEN para usar plantillas del backend.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm text-purple-200">Subir al backend (.pdf)</label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleRemoteUpload}
                  disabled={remoteBusy || !API_TOKEN}
                  className="block w-full text-purple-200 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-purple-200 file:text-purple-900"
                />
              </div>
            </div>

            {templateName && (
              <p className="text-sm text-purple-200">
                Plantilla cargada:{" "}
                <span className="font-semibold">{templateName}</span>
              </p>
            )}

            {detectedFields && detectedFields.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                <div>
                  <label className="block text-sm mb-1">Campo título</label>
                  <select
                    className="w-full bg-white/20 rounded-md px-3 py-2"
                    value={titleFieldName}
                    onChange={(e) => setTitleFieldName(e.target.value)}
                  >
                    {detectedFields.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">Campo cuerpo</label>
                  <select
                    className="w-full bg-white/20 rounded-md px-3 py-2"
                    value={bodyFieldName}
                    onChange={(e) => setBodyFieldName(e.target.value)}
                  >
                    <option value="">(Área genérica)</option>
                    {detectedFields.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : templateName ? (
              <p className="text-xs text-purple-300 italic mt-1">
                No se detectaron campos de formulario. Se usará un área genérica de texto.
              </p>
            ) : null}
          </section>

          {/* 2. CONTENIDO */}
          <section className="bg-white/10 p-6 rounded-xl border border-white/20 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-purple-300">2. Contenido</h2>
              <span className="text-xs text-purple-200/80">
                {summary.hasContent ? "✅ Listo" : "⏳ Pendiente"}
              </span>
            </div>

            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white/20 rounded-md px-3 py-2"
              placeholder="Aquí va el título"
            />

            <textarea
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full bg-white/20 rounded-md px-3 py-2"
              placeholder="Aquí va el contenido"
            />

            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <label className="inline-flex items-center px-4 py-2 border border-white/20 rounded-md cursor-pointer bg-white/10">
                <span>Subir contenido (.txt, .docx, .pdf)</span>
                <input
                  type="file"
                  accept=".txt,.docx,.pdf"
                  className="hidden"
                  disabled={!pdfReady}
                  ref={contentFileInputRef}
                  onChange={handleContentFileChange}
                />
              </label>

              <button
                onClick={() => {
                  setTitle("");
                  setBody("");
                  setSuccessMsg("Contenido limpiado.");
                  setTimeout(() => setSuccessMsg(null), 2000);
                }}
                className="px-4 py-2 rounded-md border border-white/20 bg-white/10 hover:bg-white/15 text-sm"
              >
                Limpiar contenido
              </button>
            </div>
          </section>

          {/* 3. GENERAR / DESCARGAR */}
          <section className="bg-white/10 p-6 rounded-xl border border-white/20 space-y-4">
            <h2 className="text-2xl font-bold text-purple-300">3. Generar y Descargar</h2>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={protectPdf}
                onChange={(e) => setProtectPdf(e.target.checked)}
              />
              <span>Proteger PDF (bloquear impresión y copia)</span>
            </label>

            <button
              onClick={generatePdf}
              disabled={!cleanTemplateBytes || isLoading}
              className="w-full py-3 rounded-lg font-bold bg-purple-600 hover:bg-purple-700 disabled:bg-purple-900"
            >
              {isLoading ? "Procesando..." : protectPdf ? "Generar PDF protegido" : "Generar PDF"}
            </button>

            {generatedPdfBytes && (
              <button
                onClick={downloadPdf}
                className="w-full py-3 rounded-lg bg-purple-800 hover:bg-purple-900"
              >
                Descargar PDF
              </button>
            )}
          </section>

          {/* 4. HISTORIAL */}
          <section className="bg-white/10 p-6 rounded-xl border border-white/20 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-purple-200">Historial reciente</h2>

              <button
                onClick={clearHistory}
                className="px-3 py-2 rounded-md border border-white/20 bg-white/10 hover:bg-white/15 text-xs"
              >
                Limpiar historial
              </button>
            </div>

            {history.length === 0 ? (
              <p className="text-sm text-purple-200/80">
                Aún no hay documentos en historial. Genera uno y aquí aparecerá.
              </p>
            ) : (
              <div className="space-y-3">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="rounded-lg border border-white/15 bg-black/20 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-purple-100 truncate">
                          {h.title}
                        </p>
                        <p className="text-xs text-purple-200/70 mt-1">
                          {fmtDate(h.createdAt)} · {h.protected ? "Protegido ✅" : "Sin protección ❌"}
                          {h.templateName ? ` · ${h.templateName}` : ""}
                          {typeof h.pages === "number" ? ` · ${h.pages} pág.` : ""}
                        </p>
                        {h.bodyPreview && (
                          <p className="text-sm text-purple-200/90 mt-2">
                            {h.bodyPreview}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col gap-2 shrink-0">
                        <button
                          onClick={() => reuseFromHistory(h)}
                          className="px-3 py-2 rounded-md bg-purple-700 hover:bg-purple-800 text-xs font-semibold"
                        >
                          Reusar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-purple-200/60">
              Nota: el historial se guarda en este navegador. No se sincroniza entre computadoras (eso es el siguiente nivel).
            </p>
          </section>
        </div>

        {/* Columna derecha: panel resumen Pro */}
        <aside className="lg:sticky lg:top-6 h-fit space-y-4">
          <section className="bg-white/10 p-6 rounded-xl border border-white/20">
            <h3 className="text-lg font-bold text-purple-200">Resumen</h3>

            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-purple-200/80">Plantilla</span>
                <span className="font-semibold">
                  {summary.hasTemplate ? "Lista ✅" : "Pendiente ⏳"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-purple-200/80">Campos detectados</span>
                <span className="font-semibold">{summary.fieldsDetected || 0}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-purple-200/80">Protección</span>
                <span className="font-semibold">
                  {summary.protected ? "Activa 🔒" : "Desactivada"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-purple-200/80">Páginas</span>
                <span className="font-semibold">{summary.pages ?? "—"}</span>
              </div>

              <div className="pt-3 border-t border-white/10">
                <p className="text-xs text-purple-200/60">
                  Tip: si una plantilla trae “text title / text body”, el sistema intentará usar esas zonas.
                </p>
              </div>
            </div>
          </section>

          <section className="bg-white/10 p-6 rounded-xl border border-white/20">
            <h3 className="text-lg font-bold text-purple-200">Acciones rápidas</h3>

            <div className="mt-4 grid grid-cols-1 gap-2">
              <button
                onClick={() => {
                  setError(null);
                  setSuccessMsg("Listo.");
                  setTimeout(() => setSuccessMsg(null), 1500);
                }}
                className="px-4 py-2 rounded-md border border-white/20 bg-white/10 hover:bg-white/15 text-sm"
              >
                Cerrar mensajes
              </button>

              <button
                onClick={() => {
                  setGeneratedPdfBytes(null);
                  setGeneratedPages(null);
                  setSuccessMsg("Se limpió el PDF generado.");
                  setTimeout(() => setSuccessMsg(null), 1500);
                }}
                className="px-4 py-2 rounded-md border border-white/20 bg-white/10 hover:bg-white/15 text-sm"
              >
                Limpiar PDF generado
              </button>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
};

export default Generador;
