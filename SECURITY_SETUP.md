# Activación del acceso protegido por roles

La aplicación usa tres cuentas separadas. Ningún usuario ni contraseña debe guardarse dentro del repositorio.

## Secretos obligatorios en Cloudflare

### Conductor

- `ROUTE_USERNAME`
- `ROUTE_PASSWORD`

### Jefatura

- `JEFATURA_USERNAME`
- `JEFATURA_PASSWORD`

### Superadministrador

- `SUPERADMIN_USERNAME`
- `SUPERADMIN_PASSWORD`

### Seguridad compartida

- `ROUTE_SESSION_SECRET`
- `ROUTE_DATA_KEY`

`ROUTE_SESSION_SECRET` debe ser una cadena aleatoria larga, idealmente de 48 bytes o más. Cambiarla cierra todas las sesiones activas.

`ROUTE_DATA_KEY` debe ser exactamente una clave AES-256 de 32 bytes codificada en Base64. No la cambies sin volver a cifrar el bloque guardado en `worker/vault/sector-map.ts`.

## Permisos

- **Conductor:** recorrido, GPS, estados de viviendas, sincronización y cálculo de ruta.
- **Jefatura:** seguimiento en vivo, métricas, mapa y avance de la jornada.
- **Superadministrador:** acceso completo a las vistas y API protegidas.

Las sesiones se firman con HMAC-SHA-256, se guardan en una cookie `HttpOnly`, usan `SameSite=Strict` y tienen duración distinta según el rol. El servidor limita intentos repetidos de inicio de sesión y rechaza solicitudes de origen cruzado.

## Configurar secretos

Ejecuta cada comando desde el proyecto y pega el valor cuando Wrangler lo solicite:

```bash
npx wrangler secret put ROUTE_USERNAME
npx wrangler secret put ROUTE_PASSWORD
npx wrangler secret put JEFATURA_USERNAME
npx wrangler secret put JEFATURA_PASSWORD
npx wrangler secret put SUPERADMIN_USERNAME
npx wrangler secret put SUPERADMIN_PASSWORD
npx wrangler secret put ROUTE_SESSION_SECRET
npx wrangler secret put ROUTE_DATA_KEY
```

No uses archivos `.env` en producción ni pegues las credenciales en código, commits, capturas o mensajes grupales.

## Separación de datos

- `app/route-data.ts` no contiene registros personales y comienza vacío.
- `worker/private-route-data.ts` es solo un puente de compatibilidad.
- `worker/vault/sector-map.ts` contiene únicamente el bloque AES-256-GCM cifrado.
- el mapa recibe las viviendas desde `/api/private-route` después de autenticar una sesión válida.

Nunca guardes una copia JSON, CSV o TypeScript con nombres, direcciones o coordenadas sin cifrar dentro del repositorio.

## Verificación después del despliegue

1. una visita sin sesión solo muestra el formulario de acceso;
2. la cuenta de Conductor no muestra la vista de Jefatura;
3. la cuenta de Jefatura abre directamente el panel de seguimiento;
4. el Superadministrador puede entrar a ambas vistas;
5. una contraseña incorrecta devuelve acceso denegado;
6. cinco intentos fallidos bloquean temporalmente nuevos intentos;
7. cerrar sesión elimina el acceso al recorrido protegido;
8. las respuestas de `/api/` indican `Cache-Control: no-store`;
9. el repositorio y el proyecto de Cloudflare permanecen privados para personas no autorizadas.

También se recomienda activar una regla de rate limiting en Cloudflare para `/api/session` como segunda barrera contra ataques distribuidos.
