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

## Privacidad

Este repositorio debe permanecer privado porque contiene nombres y coordenadas del recorrido. No agregues claves, contraseñas ni archivos `.env` al repositorio.

## Dominio

La dirección principal del proyecto es [rutaverde.cl](https://rutaverde.cl).
