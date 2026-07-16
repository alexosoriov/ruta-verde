# Activación del acceso protegido

La seguridad requiere cuatro secretos en Cloudflare:

- `ROUTE_USERNAME`
- `ROUTE_PASSWORD`
- `ROUTE_SESSION_SECRET`
- `ROUTE_DATA_KEY`

La clave `ROUTE_DATA_KEY` debe ser exactamente una clave AES-256 de 32 bytes codificada en Base64. No la cambies sin volver a cifrar el bloque guardado en `worker/vault/sector-map.ts`.

## Separación de datos

- `app/route-data.ts` no contiene registros personales y comienza vacío.
- `worker/private-route-data.ts` es solo un puente de compatibilidad.
- `worker/vault/sector-map.ts` contiene únicamente el bloque AES-256-GCM cifrado.
- el mapa continúa recibiendo las viviendas desde `/api/private-route` después de autenticar la sesión.

Nunca guardes una copia JSON, CSV o TypeScript con nombres, direcciones o coordenadas sin cifrar dentro del repositorio.

Después de configurar los secretos, vuelve a desplegar el proyecto y comprueba:

1. una visita sin sesión solo muestra el formulario de acceso;
2. una contraseña incorrecta devuelve acceso denegado;
3. una contraseña correcta carga las 41 viviendas y el mapa normalmente;
4. cerrar sesión elimina el acceso a recorrido, seguimiento y Jefatura;
5. las respuestas de `/api/` indican `Cache-Control: no-store`.
