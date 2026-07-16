# Seguridad de Ruta Verde

Ruta Verde procesa direcciones y ubicación en tiempo real. Estos datos deben tratarse como información operacional privada.

## Requisitos obligatorios

1. El repositorio debe ser **privado**.
2. El despliegue debe definir `ROUTE_USERNAME` y `ROUTE_PASSWORD` como secretos.
3. Nunca se deben guardar nombres de residentes, contraseñas ni archivos `.dev.vars` en Git.
4. El acceso al dominio y a `/api/tracking` debe probarse desde una ventana privada antes de cada demostración.
5. Si alguna versión pública contuvo información personal, se debe revisar y limpiar el historial de Git.

## Configuración local

Crea un archivo `.dev.vars` que no se sube al repositorio:

```text
ROUTE_USERNAME=usuario_local
ROUTE_PASSWORD=una_clave_larga_y_unica
```

Las solicitudes locales en `localhost` se permiten aunque estas variables no existan para facilitar el desarrollo. Cualquier despliegue no local queda bloqueado si faltan los secretos.

## Configuración en Cloudflare

Configura ambos valores como secretos o variables protegidas del entorno de producción:

```bash
npx wrangler secret put ROUTE_USERNAME
npx wrangler secret put ROUTE_PASSWORD
```

Usa una contraseña única de al menos 16 caracteres y no la reutilices en otros servicios.

## Respuesta ante una exposición

- Cambia inmediatamente las credenciales.
- Desactiva temporalmente el despliegue público.
- Convierte el repositorio en privado.
- Elimina los datos sensibles del historial o crea un repositorio limpio.
- Verifica que los enlaces antiguos ya no permitan acceso.
