import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./auth";

const Entregas: React.FC = () => {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#110020] via-[#050014] to-black text-white p-6">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-2xl bg-white/5 border border-white/10 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-purple-100">Modulo Entregas</h1>
              <p className="text-sm text-purple-200/80">
                Acceso privado para la empresa actual.
              </p>
            </div>
            <button
              onClick={logout}
              className="px-3 py-2 rounded-lg text-sm bg-white/10 hover:bg-white/20 border border-white/10"
            >
              Cerrar sesion
            </button>
          </div>
          <div className="text-sm text-purple-200/80">
            Bienvenido{user?.username ? `, ${user.username}` : ""}. Aqui integraremos el
            flujo de entregas con inventario.
          </div>
          <div className="mt-6 text-xs text-purple-200/70">
            <Link to="/" className="underline hover:text-purple-100">
              Volver al inicio
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Entregas;
