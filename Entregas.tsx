import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./auth";

const BACKEND_URL = "https://hm-pdf-backend.onrender.com";
const API_BASE = (import.meta as any).env?.VITE_BACKEND_URL || BACKEND_URL;

const CANVAS_WIDTH = 520;
const CANVAS_HEIGHT = 180;

type Product = {
  id: string;
  sku: string;
  name: string;
  product_type: string;
  size?: string | null;
  isbn?: string | null;
  stock_qty: number;
  is_active: boolean;
};

type Delivery = {
  id: string;
  status: string;
  recipient_name?: string | null;
  created_at: string;
  delivered_at?: string | null;
};

type DeliveryItem = {
  product_id: string;
  quantity: number;
  sku: string;
  name: string;
  size?: string | null;
};

type DeliveryDetail = {
  id: string;
  status: string;
  recipient_name?: string | null;
  notes?: string | null;
  created_at: string;
  delivered_at?: string | null;
  items: DeliveryItem[];
};

type DeliveryToken = {
  delivery_id: string;
  token: string;
  expires_at: string;
};

declare global {
  interface Window {
    BarcodeDetector?: any;
  }
}

const Entregas: React.FC = () => {
  const { user, token, logout } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenInfo, setTokenInfo] = useState<DeliveryToken | null>(null);

  const [productForm, setProductForm] = useState({
    sku: "",
    name: "",
    product_type: "libro",
    size: "",
    isbn: "",
    stock_qty: 0,
  });

  const [deliveryForm, setDeliveryForm] = useState({
    recipient_name: "",
    notes: "",
    items: [{ product_id: "", quantity: 1 }],
  });

  const [scanToken, setScanToken] = useState("");
  const [scanActive, setScanActive] = useState(false);
  const [scanSupported, setScanSupported] = useState(true);
  const [scannedDelivery, setScannedDelivery] = useState<DeliveryDetail | null>(null);
  const [signedByName, setSignedByName] = useState("");
  const [signatureReady, setSignatureReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const animationRef = useRef<number | null>(null);
  const lastTokenRef = useRef<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const authHeaders = useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );

  const loadData = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const [productsResp, deliveriesResp] = await Promise.all([
        fetch(`${API_BASE}/api/products`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/deliveries`, { headers: authHeaders }),
      ]);
      if (!productsResp.ok) {
        throw new Error("No se pudieron cargar productos");
      }
      if (!deliveriesResp.ok) {
        throw new Error("No se pudieron cargar entregas");
      }
      setProducts(await productsResp.json());
      setDeliveries(await deliveriesResp.json());
    } catch (err: any) {
      setError(err?.message || "Error cargando datos");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

  useEffect(() => {
    if (!window.BarcodeDetector) {
      setScanSupported(false);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = CANVAS_WIDTH * ratio;
    canvas.height = CANVAS_HEIGHT * ratio;
    canvas.style.width = `${CANVAS_WIDTH}px`;
    canvas.style.height = `${CANVAS_HEIGHT}px`;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#d6bcfa";
  }, []);

  const handleCreateProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        ...productForm,
        sku: productForm.sku.trim(),
        name: productForm.name.trim(),
        size: productForm.size.trim() || null,
        isbn: productForm.isbn.trim() || null,
      };
      const resp = await fetch(`${API_BASE}/api/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.detail || "No se pudo crear el producto");
      }
      setProductForm({
        sku: "",
        name: "",
        product_type: "libro",
        size: "",
        isbn: "",
        stock_qty: 0,
      });
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Error creando producto");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateDelivery = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        recipient_name: deliveryForm.recipient_name.trim() || null,
        notes: deliveryForm.notes.trim() || null,
        items: deliveryForm.items.filter((item) => item.product_id && item.quantity > 0),
      };
      const resp = await fetch(`${API_BASE}/api/deliveries`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.detail || "No se pudo crear la entrega");
      }
      const data = await resp.json();
      setTokenInfo(data);
      setDeliveryForm({ recipient_name: "", notes: "", items: [{ product_id: "", quantity: 1 }] });
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Error creando entrega");
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerateToken = async (deliveryId: string) => {
    setError(null);
    setBusy(true);
    try {
      const resp = await fetch(`${API_BASE}/api/deliveries/${deliveryId}/token`, {
        method: "POST",
        headers: authHeaders,
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.detail || "No se pudo generar el token");
      }
      const data = await resp.json();
      setTokenInfo(data);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Error generando token");
    } finally {
      setBusy(false);
    }
  };

  const updateItem = (index: number, field: "product_id" | "quantity", value: string | number) => {
    setDeliveryForm((prev) => {
      const items = prev.items.map((item, idx) =>
        idx === index ? { ...item, [field]: value } : item,
      );
      return { ...prev, items };
    });
  };

  const addItem = () => {
    setDeliveryForm((prev) => ({
      ...prev,
      items: [...prev.items, { product_id: "", quantity: 1 }],
    }));
  };

  const removeItem = (index: number) => {
    setDeliveryForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, idx) => idx !== index),
    }));
  };

  const stopCamera = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScanActive(false);
  };

  const handleScanToken = async (value: string) => {
    if (!value) return;
    setError(null);
    setBusy(true);
    try {
      const resp = await fetch(`${API_BASE}/api/deliveries/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ token: value }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.detail || "Token invalido");
      }
      const data = await resp.json();
      setScannedDelivery(data);
      setScanToken(value);
      lastTokenRef.current = value;
      setSignatureReady(false);
      setSignedByName("");
      clearSignature();
      stopCamera();
    } catch (err: any) {
      setError(err?.message || "Error validando token");
    } finally {
      setBusy(false);
    }
  };

  const scanFrame = async () => {
    if (!scanActive || !videoRef.current || !detectorRef.current) return;
    try {
      const barcodes = await detectorRef.current.detect(videoRef.current);
      if (barcodes && barcodes.length > 0) {
        const value = barcodes[0]?.rawValue;
        if (value && value !== lastTokenRef.current) {
          await handleScanToken(value);
          return;
        }
      }
    } catch (err) {
      // Ignore scan errors for now
    }
    animationRef.current = requestAnimationFrame(scanFrame);
  };

  const startCamera = async () => {
    if (!window.BarcodeDetector) {
      setScanSupported(false);
      return;
    }
    setError(null);
    setScanActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
      animationRef.current = requestAnimationFrame(scanFrame);
    } catch (err) {
      setError("No se pudo acceder a la camara");
      stopCamera();
    }
  };

  const handleManualScan = (event: React.FormEvent) => {
    event.preventDefault();
    if (!scanToken.trim()) return;
    handleScanToken(scanToken.trim());
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    setSignatureReady(false);
  };

  const getCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = true;
    lastPointRef.current = getCanvasPoint(event);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !lastPointRef.current) return;
    const nextPoint = getCanvasPoint(event);
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(nextPoint.x, nextPoint.y);
    ctx.stroke();
    lastPointRef.current = nextPoint;
    setSignatureReady(true);
  };

  const onPointerUp = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  const confirmDelivery = async () => {
    if (!scannedDelivery) return;
    if (!signatureReady) {
      setError("Firma requerida");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const signatureBase64 = canvas.toDataURL("image/png");
    setError(null);
    setBusy(true);
    try {
      const resp = await fetch(`${API_BASE}/api/deliveries/${scannedDelivery.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          token: scanToken.trim(),
          signed_by_name: signedByName.trim() || null,
          signature_base64: signatureBase64,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.detail || "No se pudo confirmar la entrega");
      }
      setScannedDelivery(null);
      setScanToken("");
      clearSignature();
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Error confirmando entrega");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#110020] via-[#050014] to-black text-white p-6">
      <div className="flex-1 flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-purple-100">Modulo Entregas</h1>
            <p className="text-sm text-purple-200/80">
              Acceso privado para la empresa actual.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-purple-200/70">{user?.username}</span>
            <button
              onClick={logout}
              className="px-3 py-2 rounded-lg text-sm bg-white/10 hover:bg-white/20 border border-white/10"
            >
              Cerrar sesion
            </button>
          </div>
        </div>

        {error ? (
          <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 px-4 py-2 rounded-lg">
            {error}
          </div>
        ) : null}

        {tokenInfo ? (
          <div className="text-sm bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-purple-100 font-semibold">Token generado</div>
            <div className="break-all text-xs text-purple-200/80">{tokenInfo.token}</div>
            <div className="text-xs text-purple-200/60 mt-2">Expira: {new Date(tokenInfo.expires_at).toLocaleString()}</div>
          </div>
        ) : null}

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-purple-100 mb-4">Nuevo producto</h2>
            <form onSubmit={handleCreateProduct} className="flex flex-col gap-3">
              <input
                className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm"
                placeholder="SKU interno"
                value={productForm.sku}
                onChange={(event) => setProductForm((prev) => ({ ...prev, sku: event.target.value }))}
                required
              />
              <input
                className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm"
                placeholder="Nombre"
                value={productForm.name}
                onChange={(event) => setProductForm((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm"
                  value={productForm.product_type}
                  onChange={(event) => setProductForm((prev) => ({ ...prev, product_type: event.target.value }))}
                >
                  <option value="libro">Libro</option>
                  <option value="playera">Playera</option>
                  <option value="taza">Taza</option>
                  <option value="otro">Otro</option>
                </select>
                <input
                  className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm"
                  placeholder="Tamano / Medida"
                  value={productForm.size}
                  onChange={(event) => setProductForm((prev) => ({ ...prev, size: event.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm"
                  placeholder="ISBN (solo libros)"
                  value={productForm.isbn}
                  onChange={(event) => setProductForm((prev) => ({ ...prev, isbn: event.target.value }))}
                />
                <input
                  type="number"
                  className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm"
                  placeholder="Stock inicial"
                  value={productForm.stock_qty}
                  onChange={(event) =>
                    setProductForm((prev) => ({ ...prev, stock_qty: Number(event.target.value) }))
                  }
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2 rounded-lg font-bold bg-purple-600 hover:bg-purple-700 transition disabled:opacity-60"
              >
                Crear producto
              </button>
            </form>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-purple-100 mb-4">Crear entrega</h2>
            <form onSubmit={handleCreateDelivery} className="flex flex-col gap-3">
              <input
                className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm"
                placeholder="Persona que recibe"
                value={deliveryForm.recipient_name}
                onChange={(event) =>
                  setDeliveryForm((prev) => ({ ...prev, recipient_name: event.target.value }))
                }
              />
              <textarea
                className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm"
                placeholder="Notas"
                rows={2}
                value={deliveryForm.notes}
                onChange={(event) => setDeliveryForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
              <div className="flex flex-col gap-3">
                {deliveryForm.items.map((item, index) => (
                  <div key={`${index}-${item.product_id}`} className="grid grid-cols-5 gap-2">
                    <select
                      className="col-span-3 rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm"
                      value={item.product_id}
                      onChange={(event) => updateItem(index, "product_id", event.target.value)}
                    >
                      <option value="">Selecciona producto</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.sku} · {product.name} {product.size ? `(${product.size})` : ""}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      className="col-span-1 rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm"
                      min={1}
                      value={item.quantity}
                      onChange={(event) => updateItem(index, "quantity", Number(event.target.value))}
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="col-span-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-xs"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addItem}
                  className="self-start text-xs text-purple-200/80 hover:text-purple-100"
                >
                  + Agregar item
                </button>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2 rounded-lg font-bold bg-purple-700 hover:bg-purple-800 transition disabled:opacity-60"
              >
                Crear entrega
              </button>
            </form>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold text-purple-100 mb-4">Escanear entrega</h2>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col md:flex-row gap-3">
                <button
                  type="button"
                  disabled={busy || scanActive}
                  onClick={startCamera}
                  className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-sm disabled:opacity-60"
                >
                  Iniciar camara
                </button>
                <button
                  type="button"
                  disabled={!scanActive}
                  onClick={stopCamera}
                  className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm disabled:opacity-60"
                >
                  Detener
                </button>
                {!scanSupported ? (
                  <span className="text-xs text-purple-200/70">Tu navegador no soporta escaneo automatico.</span>
                ) : null}
              </div>
              <div className="bg-black/40 border border-white/10 rounded-xl p-3 flex justify-center">
                <video ref={videoRef} className="w-full max-w-xl rounded-lg" muted playsInline />
              </div>
              <form onSubmit={handleManualScan} className="flex flex-col md:flex-row gap-3">
                <input
                  className="flex-1 rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm"
                  placeholder="Pega el token"
                  value={scanToken}
                  onChange={(event) => setScanToken(event.target.value)}
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
                >
                  Validar token
                </button>
              </form>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-purple-100 mb-4">Entregas recientes</h2>
            <div className="space-y-2 text-sm">
              {deliveries.length === 0 ? (
                <div className="text-purple-200/70">Sin entregas creadas.</div>
              ) : (
                deliveries.map((delivery) => (
                  <div key={delivery.id} className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{delivery.recipient_name || "Sin nombre"}</div>
                      <div className="text-xs text-purple-200/70">{delivery.status}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRegenerateToken(delivery.id)}
                      className="px-2 py-1 rounded-lg text-xs bg-white/10 hover:bg-white/20 border border-white/10"
                    >
                      Token
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-purple-100 mb-4">Productos</h2>
            <div className="space-y-2 text-sm">
              {products.length === 0 ? (
                <div className="text-purple-200/70">Sin productos registrados.</div>
              ) : (
                products.map((product) => (
                  <div key={product.id} className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{product.sku}</div>
                      <div className="text-xs text-purple-200/70">
                        {product.name} {product.size ? `(${product.size})` : ""}
                      </div>
                    </div>
                    <div className="text-xs text-purple-200/70">Stock: {product.stock_qty}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold text-purple-100 mb-4">Firma y confirmacion</h2>
            {scannedDelivery ? (
              <div className="flex flex-col gap-4">
                <div className="text-sm text-purple-200/80">
                  Entrega para: <span className="font-semibold">{scannedDelivery.recipient_name || "Sin nombre"}</span>
                </div>
                <div className="text-xs text-purple-200/70">
                  Items:
                  <ul className="mt-2 space-y-1">
                    {scannedDelivery.items.map((item) => (
                      <li key={`${item.product_id}-${item.quantity}`}>
                        {item.sku} · {item.name} {item.size ? `(${item.size})` : ""} x {item.quantity}
                      </li>
                    ))}
                  </ul>
                </div>
                <input
                  className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm"
                  placeholder="Nombre de quien firma"
                  value={signedByName}
                  onChange={(event) => setSignedByName(event.target.value)}
                />
                <div className="border border-white/10 rounded-xl bg-black/30 p-2">
                  <canvas
                    ref={canvasRef}
                    className="w-full rounded-lg bg-black/40"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerLeave={onPointerUp}
                  />
                </div>
                <div className="flex flex-col md:flex-row gap-3">
                  <button
                    type="button"
                    onClick={clearSignature}
                    className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
                  >
                    Limpiar firma
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={confirmDelivery}
                    className="px-4 py-2 rounded-lg bg-green-500/80 hover:bg-green-500 text-sm disabled:opacity-60"
                  >
                    Confirmar entrega
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-purple-200/70">
                Escanea un token para mostrar los detalles y confirmar la entrega.
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 text-xs text-purple-200/70">
          <Link to="/" className="underline hover:text-purple-100">
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Entregas;
