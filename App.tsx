import React from "react";
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import Generador from "./Generador";
import Repositorio from "./Repositorio";
import Diagnostico from "./Diagnostico";
import Entregas from "./Entregas";
import Login from "./Login";
import { AuthProvider, useAuth } from "./auth";

/* ============================= */
/* HOME (pantalla principal)     */
/* ============================= */

const Home: React.FC = () => {
  const socials = [
    {
      name: "Web",
      href: "https://www.horaciomarchand.com/",
      icon: <img src="/favicon.png" alt="Web" className="w-5 h-5 rounded-sm" />,
    },
    {
      name: "Instagram",
      href: "https://www.instagram.com/horacio.marchand?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==",
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H7zm5 3.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 0 1 12 8.5zm0 2A2.5 2.5 0 1 0 14.5 13 2.5 2.5 0 0 0 12 10.5zm4.75-3.75a1.25 1.25 0 1 1-1.25 1.25 1.25 1.25 0 0 1 1.25-1.25z" />
        </svg>
      ),
    },
    {
      name: "Facebook",
      href: "https://www.facebook.com/horaciomarchandf",
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path d="M13 10h2.5l.5-3H13V5.5C13 4.672 13.672 4 14.5 4H16V1h-2.5A4.505 4.505 0 0 0 9 5.5V7H6v3h3v9h4z" />
        </svg>
      ),
    },
    {
      name: "YouTube",
      href: "https://www.youtube.com/@horaciomarchand",
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path d="M21.6 7.2a2.3 2.3 0 0 0-1.62-1.63C18.2 5.2 12 5.2 12 5.2s-6.2 0-7.98.37A2.3 2.3 0 0 0 2.4 7.2 24.3 24.3 0 0 0 2 12a24.3 24.3 0 0 0 .4 4.8 2.3 2.3 0 0 0 1.62 1.63C5.8 18.8 12 18.8 12 18.8s6.2 0 7.98-.37A2.3 2.3 0 0 0 21.6 16.8 24.3 24.3 0 0 0 22 12a24.3 24.3 0 0 0-.4-4.8zM10 15.2V8.8L15.5 12z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#110020] via-[#050014] to-black text-white p-6">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-extrabold mb-4 text-purple-100">
            Plataforma Documental
          </h1>

          <p className="text-purple-300 mb-10 text-center max-w-md mx-auto">
            Selecciona la acción que deseas realizar
          </p>

          <div className="flex flex-col gap-4 w-full max-w-sm mx-auto">
            <Link
              to="/generador"
              className="w-full text-center py-3 rounded-lg font-bold bg-purple-600 hover:bg-purple-700 transition"
            >
              Generar PDF protegido
            </Link>

            <Link
              to="/repositorio"
              className="w-full text-center py-3 rounded-lg font-bold bg-purple-800 hover:bg-purple-900 transition"
            >
              Repositorio de archivos
            </Link>

            <Link
              to="/diagnostico"
              className="w-full text-center py-3 rounded-lg font-bold bg-purple-900 hover:bg-purple-950 transition border border-purple-700"
            >
              Diagnóstico
            </Link>

            <Link
              to="/entregas"
              className="w-full text-center py-3 rounded-lg font-bold bg-purple-700 hover:bg-purple-800 transition border border-purple-500"
            >
              Entregas (privado)
            </Link>
          </div>
        </div>
      </div>

      <footer className="mt-10 flex flex-col items-center gap-3 text-sm text-purple-200/80">
        <div className="flex items-center gap-3">
          {socials.map((s) => (
            <a
              key={s.name}
              href={s.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-full bg-white/10 hover:bg-white/15 border border-white/10"
            >
              <span className="text-purple-100">{s.icon}</span>
              <span>{s.name}</span>
            </a>
          ))}
        </div>
        <p className="text-xs text-purple-300/70">Horacio Marchand · Plataforma Oficial</p>
      </footer>
    </div>
  );
};

const RequireAuth: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#110020] via-[#050014] to-black text-white">
        Cargando...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
};

/* ============================= */
/* APP PRINCIPAL (ROUTER)        */
/* ============================= */

const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/generador" element={<Generador />} />
          <Route path="/repositorio" element={<Repositorio />} />
          <Route path="/diagnostico" element={<Diagnostico />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/entregas"
            element={
              <RequireAuth>
                <Entregas />
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
