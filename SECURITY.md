# Seguridad de Ruta Verde

## Datos del recorrido

Los nombres, direcciones y coordenadas reales no deben aparecer como texto legible en el código fuente.

La aplicación guarda el recorrido como un bloque **AES-256-GCM** autenticado. La clave de descifrado no se incluye en GitHub y debe configurarse como secreto del despliegue.

## Secretos obligatorios de Cloudflare

Configura estos valores en el proyecto desplegado:

- `ROUTE_USERNAME`: usuario de acceso.
- `ROUTE_PASSWORD`: contraseña fuerte y exclusiva para Ruta Verde.
- `ROUTE_SESSION_SECRET`: valor aleatorio largo usado para firmar las sesiones.
- `ROUTE_DATA_KEY`: clave AES de 32 bytes codificada en Base64.

Ejemplo con Wrangler:

```bash
npx wrangler secret put ROUTE_USERNAME
npx wrangler secret put ROUTE_PASSWORD
npx wrangler secret put ROUTE_SESSION_SECRET
npx wrangler secret put ROUTE_DATA_KEY
```

La aplicación falla de forma cerrada: si falta algún secreto de autenticación no permite iniciar sesión, y si falta `ROUTE_DATA_KEY` no entrega el recorrido.

## Controles implementados

- sesión mediante cookie `HttpOnly`, `SameSite=Strict` y `Secure` en HTTPS;
- firma HMAC-SHA-256 para impedir sesiones falsificadas;
- comparación de credenciales sin diferencias de tiempo evidentes;
- cifrado AES-256-GCM con IV único, AAD y etiqueta de autenticación de 128 bits;
- endpoints de recorrido, seguimiento, estado de jornada y cálculo vial protegidos por sesión;
- respuestas privadas con `Cache-Control: no-store`;
- service worker configurado para no almacenar ninguna respuesta `/api/`.

## Advertencia sobre el historial de Git

Eliminar los datos del archivo actual **no borra las versiones antiguas del historial**, forks, clones o cachés. Como los registros estuvieron en un repositorio público, se debe:

1. cambiar inmediatamente el repositorio a **privado**;
2. reescribir el historial con una herramienta como `git filter-repo`, o migrar el código limpio a un repositorio privado nuevo;
3. eliminar ramas y pull requests antiguos que mantengan referencias a commits con datos;
4. asumir que cualquier dato publicado anteriormente pudo haber sido copiado.

No compartas las claves por commits, issues, pull requests, capturas públicas ni archivos `.env`.
