"use client";

import { useState, useTransition } from "react";
import { REGIMENES_FISCALES, USOS_CFDI } from "@motrest/dominio";
import { solicitarFactura } from "@/app/actions";

export default function FormularioFactura({
  claveLocal,
  folio,
  totalOpcional,
  codigoOpcional,
  rechazoAnterior,
}: {
  claveLocal: string;
  folio: string;
  totalOpcional?: number;
  codigoOpcional?: string;
  /** Por qué el SAT no aceptó la vez anterior (1.5.6): para corregir aquí mismo. */
  rechazoAnterior?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [estado, setEstado] = useState<"formulario" | "recibida" | "error" | "vencido">("formulario");
  const [errorMsg, setErrorMsg] = useState("");
  
  const [datos, setDatos] = useState({
    rfc: "",
    razonSocial: "",
    regimenFiscal: "",
    codigoPostal: "",
    usoCfdi: "",
    correo: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    // Todo en mayúsculas excepto el correo
    setDatos((prev) => ({ 
      ...prev, 
      [name]: name === "correo" ? value : value.toUpperCase() 
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    startTransition(async () => {
      const res = await solicitarFactura(claveLocal, folio, totalOpcional, codigoOpcional, datos);
      
      if (res.exito) {
        setEstado("recibida");
      } else {
        setErrorMsg(res.error);
        if (res.vencido) {
          setEstado("vencido");
        } else {
          setEstado("error");
        }
      }
    });
  };

  if (estado === "recibida") {
    return (
      <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-200 text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 text-green-600 rounded-full mb-4">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
        </div>
        <h2 className="title text-2xl font-bold text-gray-900">¡Listo!</h2>
        <p className="text-gray-600 mt-4 text-sm leading-relaxed">
          Tu factura te llega por correo en cuanto el restaurante la timbre. Si algún dato no coincide con tu constancia, podrás corregirlo y pedirla otra vez aquí mismo dentro de las 72 horas.
        </p>
      </div>
    );
  }

  if (estado === "vencido") {
    return (
      <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-200 text-center space-y-4">
        <h2 className="title text-2xl font-bold text-gray-900">Ticket Vencido</h2>
        <p className="text-gray-600">{errorMsg}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-200 space-y-6">
      <div className="space-y-1">
        <h2 className="title text-2xl font-bold text-gray-900">Tus Datos Fiscales</h2>
        <p className="text-gray-500 text-sm">
          Asegúrate de ingresarlos tal como aparecen en tu Constancia de Situación Fiscal.
        </p>
      </div>

      {estado === "formulario" && rechazoAnterior && (
        <div className="bg-amber-50 text-amber-900 p-4 rounded-lg text-sm border border-amber-200 space-y-1">
          <p className="font-semibold">Tu factura anterior no salió</p>
          <p>{rechazoAnterior}</p>
          <p>Corrige tus datos tal como vienen en tu Constancia de Situación Fiscal y vuelve a pedirla.</p>
        </div>
      )}

      {estado === "error" && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg text-sm border border-red-100">
          {errorMsg}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">RFC</label>
          <input
            required
            name="rfc"
            value={datos.rfc}
            onChange={handleChange}
            maxLength={13}
            placeholder="XAXX010101000"
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[var(--color-motrae)] focus:border-[var(--color-motrae)] outline-none transition-all uppercase"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Razón Social</label>
          <input
            required
            name="razonSocial"
            value={datos.razonSocial}
            onChange={handleChange}
            placeholder="EMPRESA SA DE CV"
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[var(--color-motrae)] focus:border-[var(--color-motrae)] outline-none transition-all uppercase"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Código Postal</label>
            <input
              required
              name="codigoPostal"
              value={datos.codigoPostal}
              onChange={handleChange}
              maxLength={5}
              placeholder="00000"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[var(--color-motrae)] focus:border-[var(--color-motrae)] outline-none transition-all uppercase"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Uso del CFDI</label>
            <select
              required
              name="usoCfdi"
              value={datos.usoCfdi}
              onChange={handleChange}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[var(--color-motrae)] focus:border-[var(--color-motrae)] outline-none bg-white transition-all uppercase"
            >
              <option value="">SELECCIONA UN USO</option>
              {USOS_CFDI.map((uso) => (
                <option key={uso.clave} value={uso.clave}>
                  {uso.clave} - {uso.descripcion.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Régimen Fiscal</label>
          <select
            required
            name="regimenFiscal"
            value={datos.regimenFiscal}
            onChange={handleChange}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[var(--color-motrae)] focus:border-[var(--color-motrae)] outline-none bg-white transition-all uppercase"
          >
            <option value="">SELECCIONA UN RÉGIMEN</option>
            {REGIMENES_FISCALES.map((reg) => (
              <option key={reg.clave} value={reg.clave}>
                {reg.clave} - {reg.descripcion.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Correo Electrónico</label>
          <input
            required
            type="email"
            name="correo"
            value={datos.correo}
            onChange={handleChange}
            placeholder="ejemplo@correo.com"
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[var(--color-motrae)] focus:border-[var(--color-motrae)] outline-none transition-all"
          />
        </div>
      </div>

      <button
        disabled={isPending}
        className="w-full bg-[var(--color-motrae)] hover:bg-[var(--color-motrae-dark)] text-white font-bold py-4 px-8 rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex justify-center"
      >
        {isPending ? "Solicitando..." : "Solicitar Factura"}
      </button>
    </form>
  );
}
