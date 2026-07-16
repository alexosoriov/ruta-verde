# Ruta Verde

Aplicación privada para gestionar el recorrido de recolección de reciclaje del sector Santuario, Puerto Montt.

## Funciones principales

- Mapa vial y vista satelital.
- Recorrido ajustado a las calles reales.
- Seguimiento GPS del camión en tiempo real.
- Avance automático al llegar a una vivienda.
- Estados por vivienda: pendiente, completada y omitida.
- Navegación directa mediante Google Maps.
- Funcionamiento sin conexión con almacenamiento cifrado.
- Panel de gestión y resumen de la jornada.
- Instalación en teléfono o computador como aplicación PWA.
- Acceso separado para Conductor, Jefatura y Superadministrador.

## Roles de acceso

- **Conductor:** recorrido, GPS, registro de retiros y sincronización de jornada.
- **Jefatura:** seguimiento, avance, métricas y ubicación del camión.
- **Superadministrador:** acceso completo a vistas y funciones protegidas.

Las credenciales se configuran exclusivamente mediante secretos de Cloudflare. No existen usuarios ni contraseñas escritos dentro del código.

## Protección de datos

- recorrido base cifrado con AES-256-GCM;
- jornadas y seguimiento cifrados antes de guardarse en Cloudflare D1;
- subclaves separadas mediante HKDF-SHA-256;
- IndexedDB y respaldos offline cifrados con una clave no extraíble del dispositivo;
- bloqueo persistente de intentos de acceso;
- API protegidas por sesión y permisos según el rol.

Consulta `SECURITY.md` y `SECURITY_SETUP.md` antes de desplegar.

## Ejecutar localmente

Requiere Node.js 22 o una versión posterior.

```bash
npm ci
npm run dev
```

## Verificación

```bash
npm run lint
npm test
```

## Compilar para producción

```bash
npm run build
```

## Seguridad y privacidad

Este repositorio procesa nombres, direcciones y coordenadas. Debe permanecer privado y no debe contener claves, contraseñas, archivos `.env` ni copias de datos sin cifrar.

## Dominio

La dirección principal del proyecto es [rutaverde.cl](https://rutaverde.cl).
