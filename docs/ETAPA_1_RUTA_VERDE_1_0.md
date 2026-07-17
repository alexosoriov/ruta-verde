# Ruta Verde 1.0 — Etapa 1: precisión y navegación

## Alcance completado

- GPS de recorrido y seguimiento del camión.
- Identificación de viviendas con coordenadas dudosas.
- Editor visual para mover una vivienda tocando el mapa o arrastrando su marcador.
- Corrección de calle, número y observaciones para el conductor.
- Registro del motivo, fecha, coordenada anterior, coordenada nueva e historial de cambios.
- Almacenamiento local cifrado de las correcciones.
- Restauración de la ubicación original.
- Respaldo exportable de correcciones en JSON.
- Navegación giro a giro desde la posición actual hasta la siguiente vivienda pendiente.
- Flechas, distancia hasta la maniobra, calle, distancia total y tiempo aproximado.
- Avisos de voz en español de Chile antes del giro, durante la maniobra y al llegar.
- Recalculo periódico según el movimiento del vehículo.
- Orientación directa de respaldo cuando no hay conexión o el servicio de rutas falla.
- Diagnóstico de GPS, voz, conexión y viviendas cargadas.

## Uso en terreno

1. Iniciar la jornada y permitir ubicación precisa.
2. Activar la guía giro a giro si no se activa automáticamente.
3. Seguir la flecha, distancia y aviso por voz.
4. Para corregir una vivienda, abrir **Precisión 1.0**.
5. Seleccionar la vivienda y mover el punto hasta la entrada real.
6. Escribir el motivo y guardar para recalcular la ruta.
7. Exportar el respaldo de correcciones al terminar la revisión.

## Prueba de aceptación en terreno

La Etapa 1 queda técnicamente cerrada cuando una ruta real confirme:

- Los puntos corregidos coinciden con las entradas donde se detiene el camión.
- Los giros se anuncian con tiempo suficiente.
- La voz se escucha correctamente dentro del vehículo.
- La siguiente vivienda cambia después de marcar un retiro o una ausencia.
- El recorrido continúa funcionando cuando la señal se interrumpe.
- No se pierde el avance ni las correcciones al cerrar y volver a abrir la aplicación.

## Siguiente etapa

La Etapa 2 centralizará los datos en una base de datos y agregará usuarios, roles, camiones, rutas administrables, historial y panel de administración.
