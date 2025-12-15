import React, { useState, useCallback, useEffect, useRef } from "react";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const BACKEND_URL = "https://hm-pdf-backend.onrender.com";

declare global {
  interface Window {
    mammoth: any;
    pdfjsLib: any;
  }
}

type FieldRect = { x: number; y: number; width: number; height: number };

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
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim());

  let idx = lines.findIndex((l) => l && !isStopwordLine(l));
  if (idx === -1) return { title: "Sin título", body: "" };

  let title = lines[idx];
  if (title.length > 140) title = title.slice(0, 140) + "…";

  const body = lines.slice(idx + 1).join("\n").trim();
  return { title, body };
};

/* ============================= */
/* COMPONENTE PRINCIPAL          */
/* ============================= */

const App: React.FC = () => {
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
  const [generatedPdfBytes, setGeneratedPdfBytes] = useState<Uint8Array | null>(
    null
  );
  const [pdfReady, setPdfReady] = useState(false);

  // 🔒 Checkbox para proteger el PDF (activado por defecto)
  const [protectPdf, setProtectPdf] = useState(true);

  const contentFileInputRef = useRef<HTMLInputElement>(null);

  /* Espera a que PDF.js esté listo */
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

  const handleTemplateChange = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    setError(null);
    setGeneratedPdfBytes(null);
    setDetectedFields(null);
    setFieldRects({});
    setTitleFieldName("");
    setBodyFieldName("");
    setTemplateName(file.name);

    try {
      const bytes = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

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
          const pdfjs = await window.pdfjsLib.getDocument({ data: bytes }).promise;
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
    } catch (e) {
      console.error(e);
      setError("No se pudo analizar la plantilla.");
    }
  };

  /* ========================================================= */
  /*    2. CARGAR CONTENIDO (TXT/DOCX/PDF)                     */
  /* ========================================================= */

  const parseTxtToText = async (file: File) => file.text();

  const parseDocxToText = async (ab: ArrayBuffer) => {
    const res = await window.mammoth.extractRawText({ arrayBuffer: ab });
    return res.value.replace(/\u0000/g, "").replace(/\n{3,}/g, "\n\n").trim();
  };

  const parsePdfToText = async (file: File) => {
    if (!window.pdfjsLib) throw new Error("pdf.js no cargado");

    const ab = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: ab }).promise;

    const lines: string[] = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent({ normalizeWhitespace: true });

      const headerBandTop = viewport.height - 120;
      const rows: any = {};

      tc.items.forEach((it: any) => {
        const s = (it.str || "").trim();
        if (!s) return;
        const [, , , , x, y] = it.transform;
        if (y >= headerBandTop) return;
        const yKey = Math.round(y);
        rows[yKey] ??= { y, chunks: [] };
        rows[yKey].chunks.push({ x, s });
      });

      const sortedY = Object.keys(rows)
        .map(Number)
        .sort((a, b) => b - a);

      const pageLines = sortedY.map((k) =>
        rows[k].chunks
          .sort((a: any, b: any) => a.x - b.x)
          .map((c: any) => c.s)
          .join(" ")
          .trim()
      );

      const filtered = pageLines.filter((ln: string) => {
        if (!ln) return false;
        if (FOOTER_PATTERNS.some((rx) => rx.test(ln))) return false;
        const pure = ln.trim().toLowerCase();
        if (HEADER_STOPWORDS.includes(pure)) return false;
        return true;
      });

      lines.push(...filtered, "");
    }

    let text = lines.join("\n");
    text = text.replace(/-\n(?=[a-záéíóúñ])/gi, "");
    text = text.replace(/\n{3,}/g, "\n\n").trim();

    return text;
  };

  const handleContentFileChange = async (
    ev: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    try {
      setError(null);

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
    setGeneratedPdfBytes(null);

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

      // Plantilla específica: plantilla3 → bajamos un poco el título
      const isPlantilla3 =
        templateName && templateName.toLowerCase().includes("plantilla3");

      // ========= MÁRGENES ADAPTATIVOS =========
      let marginX: number;
      let bottomMargin: number;
      let topMarginFirst: number;
      let topBandFlow: number;

      if (usingFormFields) {
        // Plantillas con text title/text body
        marginX = 72;
        bottomMargin = 72;
        topMarginFirst = 140;
        topBandFlow = 72; // no se usa si hay bodyField (rectForPage se encarga)
      } else {
        // Plantillas sin campos (QR, barras, etc.)
        marginX = 48;
        bottomMargin = 96;

        // 🔧 Ajuste: si es la plantilla3, bajamos más el título
        if (isPlantilla3) {
          topMarginFirst = 110; // más espacio arriba para el título
        } else {
          topMarginFirst = 80;
        }

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

      // Si hay text body, segunda página en adelante usa un rectángulo
      // más alto que combina título + cuerpo.
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

      /* ===== CUERPO: RESPETA SALTOS DE LÍNEA ===== */

      const rawBody = normalizeBody(body);

      // Bloques separados por líneas en blanco (2+ saltos)
      const blocks = rawBody
        .split(/\n{2,}/)
        .map((b) => b.replace(/\s+$/g, "")) // quita espacios al final
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

      const lineTooLow = () =>
        currentY < currentRect.y + PAD + FONT_BODY;

      for (let bi = 0; bi < blocks.length; bi++) {
        const block = blocks[bi];

        // Cada salto simple de línea dentro del bloque se respeta como "verso"
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

        // Espacio extra entre bloques (estrofas/párrafos)
        if (bi < blocks.length - 1) {
          if (lineTooLow()) await ensureNewPage();
          currentY -= LINE_H;
        }
      }

      /* ===== PAGINACIÓN (adaptativa) ===== */

      const total = pdfDoc.getPageCount();
      if (total > 1) {
        const fontSmall = await pdfDoc.embedFont(StandardFonts.Helvetica);

        const footerY = usingFormFields ? 32 : 72; // un poco arriba del borde

        for (let i = 0; i < total; i++) {
          const pg = pdfDoc.getPage(i);
          pg.drawText(`Página ${i + 1} de ${total}`, {
            x: pg.getWidth() - 110,
            y: footerY,
            font: fontSmall,
            size: 9,
            color: rgb(0.35, 0.35, 0.35),
          });
        }
      }

      // ===== Guardar PDF generado (sin protección todavía) =====
      const out = await pdfDoc.save();

      // Si NO queremos protección, usamos el PDF tal cual
      if (!protectPdf) {
        setGeneratedPdfBytes(out);
      } else {
        // Si SÍ queremos protección, mandamos el PDF al backend en Render
        try {
          const fileName =
            title.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40) ||
            "documento";

          const file = new File([out], `${fileName}.pdf`, {
            type: "application/pdf",
          });

          const formData = new FormData();
          formData.append("archivo", file);

          const resp = await fetch(`${BACKEND_URL}/proteger-pdf`, {
            method: "POST",
            body: formData,
          });

          if (!resp.ok) {
            throw new Error(`Backend respondió ${resp.status}`);
          }

          const blob = await resp.blob();
          const buf = await blob.arrayBuffer();
          const protectedBytes = new Uint8Array(buf);

          setGeneratedPdfBytes(protectedBytes);
        } catch (err: any) {
          setError("Error al proteger PDF: " + err.message);
        }
      }
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
  ]);

  /* ========================================================= */
  /*    DESCARGAR PDF                                          */
  /* ========================================================= */

  const downloadPdf = () => {
    if (!generatedPdfBytes) return;

    const blob = new Blob([generatedPdfBytes], { type: "application/pdf" });
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

  /* ========================================================= */
  /*                      INTERFAZ UI                           */
  /* ========================================================= */

  return (
    <div className="min-h-screen text-white p-6 bg-gradient-to-b from-[#110020] via-[#050014] to-black">
      <header className="flex flex-col items-center mb-10">
        <h1 className="text-4xl font-extrabold text-center text-purple-100">
          Generador de Documentos
        </h1>
        <p className="mt-2 text-sm text-purple-300 uppercase tracking-[0.25em]">
          Plataforma Educativa Horacio Marchand
        </p>
      </header>

      <main className="max-w-3xl mx-auto">
        {/* 1. PLANTILLA */}
        <section className="bg-white/10 p-6 rounded-xl border border-white/20 space-y-4">
          <h2 className="text-2xl font-bold text-purple-300">1. Plantilla</h2>

          <input
            type="file"
            accept=".pdf"
            onChange={handleTemplateChange}
            className="block w-full text-purple-200 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-purple-200 file:text-purple-900"
          />

          {templateName && (
            <p className="text-sm text-purple-200">
              Plantilla cargada:{" "}
              <span className="font-semibold">{templateName}</span>
            </p>
          )}

          {detectedFields && detectedFields.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 mt-2">
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
                <label className="block textsm mb-1">Campo cuerpo</label>
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
              No se detectaron campos de formulario. Se usará un área genérica
              de texto respetando el membrete.
            </p>
          ) : null}
        </section>

        {/* 2. CONTENIDO */}
        <section className="bg-white/10 p-6 rounded-xl border border-white/20 mt-8 space-y-6">
          <h2 className="text-2xl font-bold text-purple-300">2. Contenido</h2>

          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-white/20 rounded-md px-3 py-2"
            placeholder="Aquí va el título"
          />

          <textarea
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full bg-white/20 rounded-md px-3 py-2"
            placeholder="Aquí va el contenido"
          />

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
        </section>

        {/* 3. GENERAR / DESCARGAR */}
        <section className="bg-white/10 p-6 rounded-xl border border-white/20 mt-8 space-y-4">
          <h2 className="text-2xl font-bold text-purple-300">
            3. Generar y Descargar
          </h2>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <label className="inline-flex items-center gap-2 text-sm mb-2">
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
            {isLoading ? "Procesando..." : "Generar PDF"}
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
      </main>
    </div>
  );
};

export default App;
