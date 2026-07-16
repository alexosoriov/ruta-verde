# Activación del acceso protegido

La rama de seguridad requiere cuatro secretos en Cloudflare:

- `ROUTE_USERNAME`
- `ROUTE_PASSWORD`
- `ROUTE_SESSION_SECRET`
- `ROUTE_DATA_KEY`

La clave `ROUTE_DATA_KEY` debe ser exactamente una clave AES-256 de 32 bytes codificada en Base64. No la cambies sin volver a cifrar `worker/private-route-data.ts`.

Después de configurar los secretos, vuelve a desplegar el proyecto y comprueba:

1. una visita sin sesión solo muestra el formulario de acceso;
2. una contraseña incorrecta devuelve acceso denegado;
3. una contraseña correcta carga las 41 viviendas;
4. cerrar sesión elimina el acceso a recorrido, seguimiento y Jefatura;
5. las respuestas de `/api/` indican `Cache-Control: no-store`.
