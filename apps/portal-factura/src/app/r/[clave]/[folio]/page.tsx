import FormularioFactura from "@/components/FormularioFactura";
import { consultarTicket } from "@/app/actions";
import { notFound } from "next/navigation";

interface Params {
  clave: string;
  folio: string;
}

interface SearchParams {
  t?: string;
}

/** Una tarjeta de estado: el comensal volvió a abrir su QR y no hay nada que llenar. */
function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-200 text-center space-y-3">
      <h2 className="title text-2xl font-bold text-gray-900">{titulo}</h2>
      <p className="text-gray-600">{texto}</p>
    </div>
  );
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const p = await params;
  const s = await searchParams;

  if (!p.clave || !p.folio || !s.t) {
    notFound();
  }

  /*
   * EN QUÉ VA (1.5.6). Quien vuelve a abrir su QR tiene que ver si su factura
   * está en camino, si ya salió, o por qué no salió —y corregirlo aquí mismo—.
   * Es la mitad de «portal + correo» que decidió Gonzalo: el correo no llega si
   * el restaurante no configuró el suyo, el portal siempre contesta.
   */
  const estado = await consultarTicket(p.clave, p.folio, s.t);

  return (
    <div className="w-full flex-grow flex flex-col justify-center">
      <div className="mb-8 text-center space-y-2">
        <h1 className="title text-3xl font-bold text-gray-900 tracking-tight">
          Factura tu Ticket
        </h1>
        <p className="text-gray-500">
          Folio: <span className="font-semibold text-gray-700">{p.folio}</span>
        </p>
      </div>

      {estado.estado === "solicitado" ? (
        <Aviso
          titulo="Tu factura está en camino"
          texto="Ya la pediste. En cuanto el restaurante la timbre te llega por correo; revisa también tu carpeta de spam."
        />
      ) : estado.estado === "facturado" ? (
        <Aviso
          titulo="Este ticket ya tiene su factura"
          texto="Se envió al correo con el que la pediste. Si no la encuentras, pídesela al restaurante."
        />
      ) : estado.estado === "vencido" ? (
        <Aviso
          titulo="Ticket vencido"
          texto="Ya pasaron las 72 horas desde su cobro. Pide tu factura directamente en el restaurante."
        />
      ) : (
        <>
          {estado.estado === "desconocido" && (
            <p className="mb-4 text-center text-sm text-gray-500">
              Si acabas de pagar, espera unos minutos: el restaurante está registrando tu ticket.
            </p>
          )}
          <FormularioFactura
            claveLocal={p.clave}
            folio={p.folio}
            codigoOpcional={s.t}
            rechazoAnterior={estado.estado === "disponible" ? estado.rechazo : undefined}
          />
        </>
      )}
    </div>
  );
}
