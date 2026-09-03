-- Dónde viven los instaladores, y quién puede bajárselos.
--
-- Esto estaba creado a mano en el proyecto y no en una migración, que es la
-- deriva exacta que la integración con GitHub viene a impedir: un proyecto
-- nuevo —una rama de vista previa, o el día que haya que reconstruir— habría
-- salido sin bucket, y el canal de actualizaciones habría fallado al descargar
-- con un 400 que no apunta a nada.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'instaladores',
  'instaladores',
  -- PRIVADO. Un ejecutable de MOTRAE servido en abierto es un binario que
  -- cualquiera estudia y, sobre todo, un sitio al que apuntar a un local si
  -- algún día se logra colar una URL.
  false,
  -- El instalador lleva Node dentro: ~26 MB hoy. El tope deja margen sin
  -- convertir el bucket en un sitio donde quepa cualquier cosa.
  300 * 1024 * 1024,
  array[
    'application/octet-stream',
    'application/x-msdownload',
    'application/vnd.microsoft.portable-executable'
  ]
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Un local baja SU instalador, no el catálogo
-- ---------------------------------------------------------------------------

-- No basta con tener sesión: un local al que se le ofrece la 1.3.5 no puede
-- bajarse la beta que se le está probando a otro. El objeto se llama
-- "<version>.exe", así que la regla es que ese nombre sea el de la versión
-- asignada a quien pregunta — la misma política de `versiones`, aplicada al
-- archivo.
--
-- Comprobado contra el proyecto real: el canario firma su descarga, el vecino
-- recibe «Object not found» —ni le confirma que el archivo exista— y sin sesión
-- no hay nada.
drop policy if exists "un local baja solo el instalador que le toca" on storage.objects;

create policy "un local baja solo el instalador que le toca"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'instaladores'
    and privado.sucursal_actual() is not null
    and name = privado.version_ofrecida(privado.sucursal_actual()) || '.exe'
  );

-- NO se crea ninguna política de escritura, y es deliberado: quien sube un
-- instalador es Central con la llave de servicio, que se salta RLS y no
-- necesita permiso. Una política de INSERT aquí sería la forma de que un local
-- comprometido dejara un ejecutable en el sitio del que se sirven todos los
-- demás.
