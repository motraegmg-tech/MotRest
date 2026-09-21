"use client";

import { useState } from "react";
import FormularioFactura from "./FormularioFactura";

export default function EntradaManual() {
  const [paso, setPaso] = useState<1 | 2>(1);
  const [clave, setClave] = useState("");
  const [folio, setFolio] = useState("");
  const [total, setTotal] = useState(""); // El usuario introduce pesos (ej. 1064.00)

  const handleSiguiente = (e: React.FormEvent) => {
    e.preventDefault();
    if (clave && folio && total) {
      setPaso(2);
    }
  };
  if (paso === 2) {
    // Convertir total a centavos, ignorando $ y comas
    const parseado = parseFloat(total.replace(/[^0-9.]/g, ''));
    const totalEnCentavos = isNaN(parseado) ? 0 : Math.round(parseado * 100);
    
    return (
      <div className="w-full flex-grow flex flex-col justify-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="mb-8 text-center space-y-2">
          <button 
            onClick={() => setPaso(1)} 
            className="text-[var(--color-motrae)] text-sm font-medium mb-4 hover:underline"
          >
            ← Volver a los datos del ticket
          </button>
          <h1 className="title text-3xl font-bold text-gray-900 tracking-tight">
            Factura tu Ticket
          </h1>
          <p className="text-gray-500">
            Local: <span className="font-semibold text-gray-700">{clave}</span> · 
            Folio: <span className="font-semibold text-gray-700">{folio}</span>
          </p>
        </div>
        <FormularioFactura
          claveLocal={clave}
          folio={folio}
          totalOpcional={totalEnCentavos}
        />
      </div>
    );
  }

  return (
    <div className="w-full flex-grow flex flex-col justify-center">
      <div className="mb-8 text-center space-y-2">
        <h1 className="title text-3xl font-bold text-gray-900 tracking-tight">
          Recupera tu Factura
        </h1>
        <p className="text-gray-500">
          Ingresa los datos impresos en tu ticket
        </p>
      </div>

      <form onSubmit={handleSiguiente} className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-200 space-y-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Clave del Restaurante</label>
            <input
              required
              value={clave}
              onChange={(e) => setClave(e.target.value.toUpperCase())}
              placeholder="RODIZIO"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[var(--color-motrae)] focus:border-[var(--color-motrae)] outline-none transition-all uppercase"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Folio del Ticket</label>
            <input
              required
              value={folio}
              onChange={(e) => setFolio(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="A1B2C3D4"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[var(--color-motrae)] focus:border-[var(--color-motrae)] outline-none transition-all uppercase"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Total (con decimales)</label>
            <div className="relative">
              <span className="absolute left-4 top-3 text-gray-500">$</span>
              <input
                required
                type="text"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="1064.00"
                className="w-full pl-8 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[var(--color-motrae)] focus:border-[var(--color-motrae)] outline-none transition-all"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="w-full bg-[var(--color-motrae)] hover:bg-[var(--color-motrae-dark)] text-white font-bold py-4 px-8 rounded-xl shadow-md transition-all active:scale-95"
        >
          Continuar
        </button>
      </form>
    </div>
  );
}
