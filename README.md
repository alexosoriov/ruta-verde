# Ruta Verde

Aplicación privada para gestionar el recorrido de recolección de reciclaje del sector Santuario, Puerto Montt.

## Funciones principales

- Mapa vial y vista satelital.
- Recorrido ajustado a las calles reales.
- Seguimiento GPS del camión en tiempo real.
- Avance automático al llegar a una vivienda.
- Estados por vivienda: pendiente, completada y omitida.
- Navegación directa mediante Google Maps.
- Funcionamiento sin conexión y recuperación del progreso.
- Panel de gestión y resumen de la jornada.
- Instalación en teléfono o computador como aplicación PWA.
- Diseño adaptable para uso en terreno.
- Acceso separado para Conductor, Jefatura y Superadministrador.

## Roles de acceso

- **Conductor:** utiliza el recorrido, GPS y registro de retiros.
- **Jefatura:** revisa seguimiento, avance, métricas y ubicación del camión.
- **Superadministrador:** tiene acceso completo a las vistas y funciones protegidas.

Las credenciales se configuran exclusivamente mediante secretos de Cloudflare. No existen usuarios ni contraseñas escritos dentro del código.

## Ejecutar localmente

Requiere Node.js 22 o una versión posterior.

```bash
npm ci
npm run dev
```

La aplicación quedará disponible en la dirección que muestre la terminal.

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

Consulta `SECURITY_SETUP.md` antes de desplegar. El recorrido privado se descifra únicamente después de autenticar una sesión válida y las API aplican permisos según el rol.

Este repositorio debe permanecer privado porque el proyecto procesa nombres, direcciones y coordenadas del recorrido. No agregues claves, contraseñas, archivos `.env` ni copias de datos sin cifrar al repositorio.

## Dominio

La dirección principal del proyecto es [rutaverde.cl](https://rutaverde.cl).
