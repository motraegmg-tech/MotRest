"use client";

import { useEffect, useState } from "react";
import { buscarTicket } from "@/app/actions";
import FormularioFactura from "./FormularioFactura";

const FORMA_CLAVE = /^[A-Z0-9-]{3,20}$/;
const FORMA_FOLIO = /^[0-9A-Z]{8}$/;

type Busqueda =
  | { estado: "esperando" }
  | { estado: "buscando" }
  | { estado: "encontrado"; total: number }
  | { estado: "error"; mensaje: string };

export default function EntradaManual() {
  const [paso, setPaso] = useState<1 | 2>(1);
  const [clave, setClave] = useState("");
  const [folio, setFolio] = useState("");
  const [busqueda, setBusqueda] = useState<Busqueda>({ estado: "esperando" });

  /*
   * El total se llena solo: en cuanto la clave y el folio tienen su forma
   * completa, se busca el ticket. La pausa evita buscar a medio teclear, y la
   * bandera descarta la respuesta de una búsqueda que ya no corresponde a lo
   * que hay escrito.
   */
  useEffect(() => {
    if (!FORMA_CLAVE.test(clave) || !FORMA_FOLIO.test(folio)) {
      setBusqueda({ estado: "esperando" });
      return;
    }
    let vigente = true;
    setBusqueda({ estado: "buscando" });
    const espera = setTimeout(() => {
      void buscarTicket(clave, folio)
        .then((r) => {
          if (!vigente) return;
          setBusqueda(r.ok ? { estado: "encontrado", total: r.total } : { estado: "error", mensaje: r.error });
        })
        .catch(() => {
          if (vigente) setBusqueda({ estado: "error", mensaje: "No pudimos buscar tu ticket. Inténtalo de nuevo." });
        });
    }, 400);
    return () => {
      vigente = false;
      clearTimeout(espera);
    };
  }, [clave, folio]);

  const totalEnCentavos = busqueda.estado === "encontrado" ? busqueda.total : 0;
  const totalVisible =
    busqueda.estado === "encontrado"
      ? (busqueda.total / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "";

  const handleSiguiente = (e: React.FormEvent) => {
    e.preventDefault();
    if (busqueda.estado === "encontrado") setPaso(2);
  };
  if (paso === 2) {
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
          Emite tu Factura
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
              aria-describedby="ayuda-clave"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[var(--color-motrae)] focus:border-[var(--color-motrae)] outline-none transition-all uppercase"
            />
            <p id="ayuda-clave" className="mt-1 text-xs text-gray-500">
              La clave del restaurante se encuentra en la parte inferior de su ticket de compra.
            </p>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Total del ticket</label>
            <div className="relative">
              <span className="absolute left-4 top-3 text-gray-500">$</span>
              <input
                readOnly
                tabIndex={-1}
                type="text"
                value={totalVisible}
                placeholder={busqueda.estado === "buscando" ? "Buscando tu ticket…" : "Se llena solo al escribir el folio"}
                aria-describedby="estado-ticket"
                className="w-full pl-8 pr-4 py-3 rounded-lg border border-gray-200 bg-gray-50 text-gray-900 outline-none"
              />
            </div>
            <p id="estado-ticket" role="status" className="mt-1 text-xs min-h-4">
              {busqueda.estado === "encontrado" && (
                <span className="text-[var(--color-motrae)] font-medium">Encontramos tu ticket.</span>
              )}
              {busqueda.estado === "error" && <span className="text-red-600">{busqueda.mensaje}</span>}
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={busqueda.estado !== "encontrado"}
          className="w-full bg-[var(--color-motrae)] hover:bg-[var(--color-motrae-dark)] text-white font-bold py-4 px-8 rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          Continuar
        </button>
      </form>
    </div>
  );
}
