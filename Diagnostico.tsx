import React from "react";
import { Link } from "react-router-dom";

const Diagnostico: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#110020] via-[#050014] to-black text-white p-6">
      <header className="flex items-center justify-between max-w-5xl mx-auto w-full mb-8">
        <div>
          <p className="text-sm text-purple-300 uppercase tracking-[0.25em]">
            Plataforma Educativa Horacio Marchand
          </p>
          <h1 className="text-3xl font-extrabold text-purple-100 mt-2">Diagnóstico</h1>
          <p className="text-purple-200/80 mt-1 text-sm">
            Nuevo módulo para evaluar el nivel de cliente-centrismo. Próximamente tendrás un
            asistente que te ayudará a descubrir oportunidades clave de tu negocio.
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
        <section className="bg-white/10 border border-white/15 rounded-xl p-6 space-y-4">
          <h2 className="text-2xl font-bold text-purple-200">¿Qué encontrarás aquí?</h2>
          <p className="text-purple-100/80">
            Próximamente podrás responder un diagnóstico breve (7-8 preguntas) para conocer tu
            nivel de cliente-centrismo, recibir 2-3 oportunidades clave y descargar un PDF con
            nuestro membrete y un CTA para agendar una sesión estratégica 1:1.
          </p>
          <p className="text-purple-200/70">
            Este módulo no dará pasos tácticos: el “cómo” se verá en una sesión estratégica
            personalizada. Aquí tendrás un reflejo express de tu situación y las palancas a
            explorar.
          </p>
        </section>

        <section className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-3">
          <h3 className="text-xl font-semibold text-purple-200">Estado</h3>
          <p className="text-purple-100/80">
            En desarrollo. Muy pronto podrás:
          </p>
          <ul className="list-disc list-inside text-purple-100/80 space-y-1">
            <li>Completar un breve cuestionario de diagnóstico.</li>
            <li>Ver tu nivel (Alto / Medio / Bajo) y oportunidades clave.</li>
            <li>Descargar un PDF con el diagnóstico y un CTA para agendar sesión.</li>
          </ul>
        </section>
      </main>
    </div>
  );
};

export default Diagnostico;
