# Activación de seguridad

## Secretos obligatorios en Cloudflare

Configura:

- `ROUTE_USERNAME`: usuario no predecible.
- `ROUTE_PASSWORD`: contraseña larga, exclusiva y aleatoria.
- `ROUTE_SESSION_SECRET`: secreto aleatorio de al menos 32 bytes.
- `ROUTE_DATA_KEY`: clave AES-256 de exactamente 32 bytes codificada en Base64.

```bash
npx wrangler secret put ROUTE_USERNAME
npx wrangler secret put ROUTE_PASSWORD
npx wrangler secret put ROUTE_SESSION_SECRET
npx wrangler secret put ROUTE_DATA_KEY
```

No uses como secretos los valores de ejemplos, conversaciones o commits anteriores.

## Componentes protegidos

- `app/route-data.ts` comienza vacío y no contiene registros personales.
- `worker/vault/sector-map.ts` contiene únicamente el recorrido cifrado.
- `worker/journey-state.ts` cifra jornadas completas en D1.
- `worker/live-tracking.ts` cifra ubicación, actividad y métricas remotas.
- `app/journey-db.ts` cifra IndexedDB con una clave no extraíble del dispositivo.
- `app/journey-storage.ts` cifra respaldos y cola offline de `localStorage`.

## Actualizar las viviendas

Guarda temporalmente el JSON sin cifrar dentro de `private/`, carpeta ignorada por Git, y ejecuta:

```bash
ROUTE_DATA_KEY="TU_CLAVE_BASE64" npm run security:encrypt-route -- private/route.json
```

El comando reemplaza la bóveda usando un IV aleatorio nuevo. Después elimina de forma segura el archivo temporal.

## Comprobación posterior al despliegue

1. Sin sesión solo aparece el formulario de acceso.
2. El usuario no viene escrito por defecto.
3. Cinco contraseñas incorrectas producen bloqueo temporal y cabecera `Retry-After`.
4. La contraseña correcta carga las viviendas y el mapa.
5. Jefatura recibe el seguimiento sin que D1 guarde coordenadas o actividad legibles.
6. IndexedDB y `localStorage` contienen sobres con `iv` y `data`, no nombres ni direcciones.
7. Las respuestas `/api/` usan `Cache-Control: no-store`.
8. Al cerrar sesión desaparecen del estado de la aplicación los datos descifrados.

## Rotación

Cambiar `ROUTE_SESSION_SECRET` invalida todas las sesiones existentes. Cambiar `ROUTE_DATA_KEY` requiere volver a cifrar la bóveda y eliminar o migrar los registros D1 cifrados con la clave anterior.
