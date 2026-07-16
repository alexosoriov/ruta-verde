# Seguridad de Ruta Verde

## Alcance

Ruta Verde protege nombres, direcciones, coordenadas, notas, actividad, viviendas nuevas y ubicación del vehículo tanto en el repositorio como en Cloudflare D1 y en el almacenamiento offline del teléfono.

## Cifrado del recorrido base

El recorrido original vive en `worker/vault/sector-map.ts` como un bloque **AES-256-GCM** autenticado. La clave no está en GitHub; se configura mediante el secreto `ROUTE_DATA_KEY`.

Para actualizar la lista se usa:

```bash
ROUTE_DATA_KEY="..." npm run security:encrypt-route -- private/route.json
```

La herramienta genera un IV aleatorio nuevo en cada ejecución. Nunca reutilices un IV con la misma clave.

## Cifrado de datos operativos

- Las jornadas se cifran antes de escribirse en D1.
- El seguimiento remoto se guarda en `secure_payload`; las columnas históricas de ubicación, próxima vivienda y actividad se ponen en cero o vacío.
- Se derivan subclaves independientes con HKDF-SHA-256 para jornada y seguimiento.
- Cada escritura usa AES-256-GCM, IV aleatorio de 96 bits, AAD específico del registro y etiqueta de 128 bits.
- Los registros antiguos en texto plano se migran y limpian al ser leídos.

## Protección del teléfono

- IndexedDB guarda jornadas y cola offline cifradas.
- La clave local es una `CryptoKey` AES-256 no extraíble.
- `localStorage` guarda únicamente sobres cifrados.
- Los respaldos heredados en texto plano se migran y eliminan automáticamente.
- El service worker nunca almacena respuestas `/api/`.

## Acceso

Secretos obligatorios de Cloudflare:

- `ROUTE_USERNAME`
- `ROUTE_PASSWORD`
- `ROUTE_SESSION_SECRET`
- `ROUTE_DATA_KEY`

Controles activos:

- cookie `__Host-rv_session`, `HttpOnly`, `Secure` y `SameSite=Strict` en HTTPS;
- firma HMAC-SHA-256 y sesiones de cuatro horas;
- comparación constante de credenciales;
- bloqueo progresivo después de cinco intentos fallidos;
- identificadores de límite derivados por HMAC, sin almacenar usuario o IP en claro;
- HSTS, CSP, `X-Frame-Options: DENY`, `no-referrer` y `Permissions-Policy`;
- respuestas privadas con `Cache-Control: no-store`.

## Rotación de secretos

La contraseña y `ROUTE_SESSION_SECRET` pueden rotarse directamente en Cloudflare. Para rotar `ROUTE_DATA_KEY` se debe volver a cifrar el recorrido base y migrar o eliminar los registros D1 cifrados con la clave anterior.

Nunca publiques secretos en commits, issues, pull requests, capturas, chats o archivos `.env`.

## Historial de Git

La versión actual no contiene datos personales legibles, pero versiones públicas antiguas pueden permanecer en el historial, forks, clones o cachés. El repositorio debe mantenerse privado y el historial anterior debe reescribirse o sustituirse por un repositorio privado limpio.
