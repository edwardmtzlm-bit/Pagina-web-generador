import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";

const Login: React.FC = () => {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as any)?.from?.pathname || "/entregas";

  useEffect(() => {
    if (user) {
      navigate(from, { replace: true });
    }
  }, [user, from, navigate]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError("Credenciales invalidas.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#110020] via-[#050014] to-black text-white p-6">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-6 shadow-xl">
          <h1 className="text-2xl font-bold text-purple-100 mb-2">Acceso privado</h1>
          <p className="text-sm text-purple-200/80 mb-6">
            Ingresa con tu usuario para abrir el modulo interno.
          </p>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <label className="text-sm text-purple-200">
              Usuario
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-2 w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-white"
                autoComplete="username"
              />
            </label>
            <label className="text-sm text-purple-200">
              Contrasena
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-white"
                autoComplete="current-password"
              />
            </label>
            {error ? <div className="text-sm text-red-300">{error}</div> : null}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2 rounded-lg font-bold bg-purple-600 hover:bg-purple-700 transition disabled:opacity-60"
            >
              {busy ? "Entrando..." : "Entrar"}
            </button>
          </form>
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

export default Login;
