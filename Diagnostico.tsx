import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type Step = "intro" | "form" | "result";

type Answers = {
  giro: string;
  tamano: string;
  decisiones: string;
  dolores: string;
  integracion: string;
  diferenciador: string;
  metricas: string;
  reto: string;
};

type Result = {
  nivel: "Alto" | "Medio" | "Bajo";
  oportunidades: string[];
  recomendacion: string;
};

const CTA_URL = "https://www.horaciomarchand.com/contacto";

const baseAnswers: Answers = {
  giro: "",
  tamano: "",
  decisiones: "",
  dolores: "",
  integracion: "",
  diferenciador: "",
  metricas: "",
  reto: "",
};

const Diagnostico: React.FC = () => {
  const [step, setStep] = useState<Step>("intro");
  const [answers, setAnswers] = useState<Answers>(baseAnswers);
  const [result, setResult] = useState<Result | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFormValid = useMemo(() => {
    const { giro, tamano, decisiones, dolores, integracion, diferenciador, metricas } = answers;
    return giro && tamano && decisiones && dolores && integracion && diferenciador && metricas;
  }, [answers]);

  const scoreAnswer = (a: Answers): Result => {
    const mapDecision: Record<string, number> = {
      datos: 5,
      mixto: 3,
      intuicion: 1,
    };
    const mapDolores: Record<string, number> = {
      "1": 1,
      "2": 2,
      "3": 3,
      "4": 4,
      "5": 5,
    };
    const mapIntegracion: Record<string, number> = {
      alta: 5,
      parcial: 3,
      reactiva: 2,
      silo: 1,
    };
    const mapDiferenciador: Record<string, number> = {
      "1": 1,
      "2": 2,
      "3": 3,
      "4": 4,
      "5": 5,
    };
    const mapMetricas: Record<string, number> = {
      "valor-completo": 5,
      "retencion-parcial": 4,
      "solo-financieras": 2,
      "sin-metricas": 1,
    };

    const scores = [
      mapDecision[a.decisiones] ?? 0,
      mapDolores[a.dolores] ?? 0,
      mapIntegracion[a.integracion] ?? 0,
      mapDiferenciador[a.diferenciador] ?? 0,
      mapMetricas[a.metricas] ?? 0,
    ];
    const avg = scores.reduce((s, n) => s + n, 0) / scores.length;

    let nivel: Result["nivel"] = "Medio";
    if (avg >= 4.2) nivel = "Alto";
    else if (avg <= 2.6) nivel = "Bajo";

    const oportunidades =
      nivel === "Alto"
        ? [
            "Asegurar continuidad: formaliza métricas de valor al cliente y comunícalas en todo el equipo.",
            "Dobla la apuesta en lo que te hace único y mantenlo visible en cada interacción.",
          ]
        : nivel === "Medio"
        ? [
            "Clarificar el diferenciador y estandarizar la integración Marketing-Ventas-Operaciones.",
            "Medir y comunicar indicadores de cliente (retención, quejas, tiempos de entrega).",
          ]
        : [
            "Salir al mercado: entrevistas rápidas a clientes y revisión de quejas para mapear dolores reales.",
            "Orquestar equipos multifuncionales con foco en segmentos clave y objetivos comunes de cliente.",
          ];

    const recomendacion =
      nivel === "Alto"
        ? "Consolida tu ventaja: convierte tus métricas de cliente en sistema de gestión y refuerza tu ángulo competitivo."
        : nivel === "Medio"
        ? "Define un ángulo competitivo claro, integra funciones y alinea incentivos a métricas de cliente."
        : "Reenfoca la estrategia desde el cliente: conocimiento profundo, diferenciador nítido e integración interna coordinada.";

    return { nivel, oportunidades, recomendacion };
  };

  const handleSubmit = () => {
    if (!isFormValid) {
      setError("Responde las preguntas requeridas.");
      return;
    }
    setError(null);
    const res = scoreAnswer(answers);
    setResult(res);
    setStep("result");
  };

  const handleDownloadPdf = async () => {
    if (!result) return;
    setPdfGenerating(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595, 842]); // A4
      const fontTitle = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontBody = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const margin = 50;
      let y = 780;

      page.drawText("Diagnóstico Cliente-Céntrico", {
        x: margin,
        y,
        size: 20,
        font: fontTitle,
        color: rgb(0.7, 0.6, 0.95),
      });
      y -= 30;
      page.drawText("Plataforma Educativa Horacio Marchand", {
        x: margin,
        y,
        size: 10,
        font: fontBody,
        color: rgb(0.8, 0.75, 0.9),
      });

      y -= 40;
      page.drawText("Nivel:", { x: margin, y, size: 12, font: fontTitle, color: rgb(1, 1, 1) });
      page.drawText(result.nivel, {
        x: margin + 50,
        y,
        size: 12,
        font: fontBody,
        color: rgb(1, 1, 1),
      });

      y -= 30;
      page.drawText("Oportunidades clave:", {
        x: margin,
        y,
        size: 12,
        font: fontTitle,
        color: rgb(1, 1, 1),
      });
      y -= 18;
      result.oportunidades.forEach((op) => {
        page.drawText(`• ${op}`, {
          x: margin,
          y,
          size: 10,
          font: fontBody,
          color: rgb(0.95, 0.95, 0.95),
        });
        y -= 16;
      });

      y -= 10;
      page.drawText("Recomendación:", {
        x: margin,
        y,
        size: 12,
        font: fontTitle,
        color: rgb(1, 1, 1),
      });
      y -= 18;
      page.drawText(result.recomendacion, {
        x: margin,
        y,
        size: 10,
        font: fontBody,
        color: rgb(0.95, 0.95, 0.95),
      });

      y -= 30;
      page.drawText("CTA:", {
        x: margin,
        y,
        size: 12,
        font: fontTitle,
        color: rgb(1, 1, 1),
      });
      y -= 18;
      page.drawText("Agenda Sesión Estratégica 1:1", {
        x: margin,
        y,
        size: 10,
        font: fontBody,
        color: rgb(0.9, 0.85, 1),
      });
      y -= 14;
      page.drawText(CTA_URL, {
        x: margin,
        y,
        size: 10,
        font: fontBody,
        color: rgb(0.8, 0.8, 1),
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "diagnostico_cliente_centrico.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError("No se pudo generar el PDF.");
      console.error(e);
    } finally {
      setPdfGenerating(false);
    }
  };

  const renderIntro = () => (
    <section className="bg-white/10 border border-white/15 rounded-xl p-6 space-y-4">
      <h2 className="text-2xl font-bold text-purple-200">Diagnóstico Cliente-Céntrico</h2>
      <p className="text-purple-100/80">
        Evalúa de forma rápida tu nivel de cliente-centrismo. Responde un breve cuestionario y
        obtén un resultado express con oportunidades clave. El “cómo” se ve en una sesión
        estratégica 1:1.
      </p>
      <button
        onClick={() => setStep("form")}
        className="px-4 py-3 rounded-lg bg-purple-600 hover:bg-purple-700 font-semibold"
      >
        Comenzar diagnóstico
      </button>
    </section>
  );

  const renderForm = () => (
    <section className="bg-white/10 border border-white/15 rounded-xl p-6 space-y-4">
      <h2 className="text-2xl font-bold text-purple-200">Cuestionario</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm text-purple-200">Giro del negocio</label>
          <input
            value={answers.giro}
            onChange={(e) => setAnswers({ ...answers, giro: e.target.value })}
            className="w-full bg-white/15 rounded-md px-3 py-2"
            placeholder="Ej. Servicios financieros"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-purple-200">Tamaño de la empresa</label>
          <select
            value={answers.tamano}
            onChange={(e) => setAnswers({ ...answers, tamano: e.target.value })}
            className="w-full bg-white/15 rounded-md px-3 py-2"
          >
            <option value="">Selecciona...</option>
            <option value="pequena">Pequeña (11-50)</option>
            <option value="mediana">Mediana (51-250)</option>
            <option value="grande">Grande (250+)</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm text-purple-200">Toma de decisiones estratégicas</label>
          <select
            value={answers.decisiones}
            onChange={(e) => setAnswers({ ...answers, decisiones: e.target.value })}
            className="w-full bg-white/15 rounded-md px-3 py-2"
          >
            <option value="">Selecciona...</option>
            <option value="datos">Basadas en datos del cliente</option>
            <option value="mixto">Mixto (datos + intuición)</option>
            <option value="intuicion">Intuición directiva</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm text-purple-200">Conocimiento de dolores del cliente</label>
          <select
            value={answers.dolores}
            onChange={(e) => setAnswers({ ...answers, dolores: e.target.value })}
            className="w-full bg-white/15 rounded-md px-3 py-2"
          >
            <option value="">Selecciona...</option>
            <option value="1">Muy bajo</option>
            <option value="2">Bajo</option>
            <option value="3">Medio</option>
            <option value="4">Bueno</option>
            <option value="5">Profundo</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm text-purple-200">Integración Mkt-Ventas-Operaciones</label>
          <select
            value={answers.integracion}
            onChange={(e) => setAnswers({ ...answers, integracion: e.target.value })}
            className="w-full bg-white/15 rounded-md px-3 py-2"
          >
            <option value="">Selecciona...</option>
            <option value="alta">Alta y coordinada</option>
            <option value="parcial">Parcial (proyectos puntuales)</option>
            <option value="reactiva">Solo cuando hay problemas</option>
            <option value="silo">Cada área por su lado</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm text-purple-200">Claridad del diferenciador</label>
          <select
            value={answers.diferenciador}
            onChange={(e) => setAnswers({ ...answers, diferenciador: e.target.value })}
            className="w-full bg-white/15 rounded-md px-3 py-2"
          >
            <option value="">Selecciona...</option>
            <option value="1">Muy difuso</option>
            <option value="2">Difuso</option>
            <option value="3">Medianamente claro</option>
            <option value="4">Claro</option>
            <option value="5">Muy claro y comunicado</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm text-purple-200">Métricas de valor al cliente</label>
          <select
            value={answers.metricas}
            onChange={(e) => setAnswers({ ...answers, metricas: e.target.value })}
            className="w-full bg-white/15 rounded-md px-3 py-2"
          >
            <option value="">Selecciona...</option>
            <option value="valor-completo">Retención, quejas, tiempos, satisfacción</option>
            <option value="retencion-parcial">Retención y algunas quejas</option>
            <option value="solo-financieras">Solo ingresos / número de clientes</option>
            <option value="sin-metricas">No medimos</option>
          </select>
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-sm text-purple-200">Reto actual (opcional)</label>
          <textarea
            value={answers.reto}
            onChange={(e) => setAnswers({ ...answers, reto: e.target.value })}
            className="w-full bg-white/15 rounded-md px-3 py-2"
            rows={3}
            placeholder="Ej. Retención de clientes, tiempos de entrega, inventario de quejas..."
          />
        </div>
      </div>

      {error && <p className="text-red-300 text-sm">{error}</p>}

      <div className="flex gap-3 mt-4">
        <button
          onClick={() => setStep("intro")}
          className="px-4 py-3 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20"
        >
          Volver
        </button>
        <button
          onClick={handleSubmit}
          className="px-4 py-3 rounded-lg bg-purple-600 hover:bg-purple-700 font-semibold"
        >
          Ver resultado
        </button>
      </div>
    </section>
  );

  const renderResult = () => {
    if (!result) return null;
    return (
      <section className="bg-white/10 border border-white/15 rounded-xl p-6 space-y-4">
        <h2 className="text-2xl font-bold text-purple-200">Resultado express</h2>
        <p className="text-sm text-purple-200/80">
          Este diagnóstico no incluye el “cómo” implementar. Para profundizar, agenda una sesión
          estratégica 1:1.
        </p>

        <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-2">
          <p className="text-lg text-purple-100">
            Nivel: <span className="font-bold">{result.nivel}</span>
          </p>
          <div>
            <p className="text-purple-200 font-semibold">Oportunidades:</p>
            <ul className="list-disc list-inside text-purple-100/80 space-y-1">
              {result.oportunidades.map((op, idx) => (
                <li key={idx}>{op}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-purple-200 font-semibold">Recomendación:</p>
            <p className="text-purple-100/80">{result.recomendacion}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleDownloadPdf}
            disabled={pdfGenerating}
            className="px-4 py-3 rounded-lg bg-purple-600 hover:bg-purple-700 font-semibold disabled:bg-purple-900"
          >
            {pdfGenerating ? "Generando PDF..." : "Descargar PDF"}
          </button>
          <a
            href={CTA_URL}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-3 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 font-semibold"
          >
            Agenda sesión 1:1
          </a>
          <button
            onClick={() => {
              setAnswers(baseAnswers);
              setResult(null);
              setStep("form");
            }}
            className="px-4 py-3 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20"
          >
            Rehacer diagnóstico
          </button>
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#110020] via-[#050014] to-black text-white p-6">
      <header className="flex items-center justify-between max-w-5xl mx-auto w-full mb-8">
        <div>
          <p className="text-sm text-purple-300 uppercase tracking-[0.25em]">
            Plataforma Educativa Horacio Marchand
          </p>
          <h1 className="text-3xl font-extrabold text-purple-100 mt-2">Diagnóstico</h1>
          <p className="text-purple-200/80 mt-1 text-sm">
            Evalúa tu nivel de cliente-centrismo y descubre oportunidades. El “cómo” se aborda en
            sesión estratégica.
          </p>
        </div>

        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 border border-white/20 hover:bg-white/15 text-sm"
        >
          ← Volver al inicio
        </Link>
      </header>

      <main className="max-w-5xl mx-auto flex-1 w-full space-y-6">
        {step === "intro" && renderIntro()}
        {step === "form" && renderForm()}
        {step === "result" && renderResult()}
      </main>
    </div>
  );
};

export default Diagnostico;
