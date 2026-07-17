# Ruta Verde

Aplicación privada para gestionar el recorrido de recolección de reciclaje del sector Santuario, Puerto Montt.

## Funciones principales

- Mapa vial y vista satelital.
- Recorrido ajustado a calles reales.
- Perfil de vehículo pesado configurable con altura, ancho, largo, peso y carga por eje.
- Seguimiento GPS del camión en tiempo real.
- Avance automático al llegar a una vivienda.
- Estados por vivienda: pendiente, completada y omitida.
- Navegación directa mediante Google Maps.
- Funcionamiento sin conexión con almacenamiento cifrado.
- Sincronización por vivienda entre distintos teléfonos.
- Historial de auditoría y últimas 30 revisiones cifradas por jornada.
- Panel de gestión y resumen de la jornada.
- Diagnósticos técnicos cifrados para terreno.
- Instalación en teléfono o computador como aplicación PWA.
- Acceso separado para Conductor, Jefatura y Superadministrador.

## Roles de acceso

- **Conductor:** recorrido, GPS, registro de retiros, jornada y envío de diagnósticos.
- **Jefatura:** seguimiento, avance, métricas, ubicación del camión y lectura de diagnósticos.
- **Superadministrador:** acceso completo a vistas y funciones protegidas.

Las credenciales se configuran únicamente mediante secretos o variables privadas del entorno de alojamiento. No existen usuarios ni contraseñas escritos dentro del código.

## Protección de datos

- recorrido base cifrado con AES-256-GCM;
- jornadas, revisiones, seguimiento y diagnósticos cifrados antes de guardarse en la base de datos administrada;
- subclaves separadas mediante HKDF-SHA-256;
- IndexedDB y respaldos offline cifrados con una clave no extraíble del dispositivo;
- bloqueo persistente de intentos de acceso;
- API protegidas por sesión y permisos según el rol;
- sincronización de conflictos realizada después de descifrar en el servidor y antes de volver a cifrar.

Consulta `SECURITY.md`, `SECURITY_SETUP.md`, `OPERATIONS_RUNBOOK.md` y `FIELD_TEST_CHECKLIST.md` antes de desplegar.

## Ejecutar localmente

Requiere Node.js 22 o una versión posterior.

```bash
npm ci
npm run dev
```

Para las variables privadas de desarrollo, copia `.env.example` como `.env.local` y reemplaza todos los valores de ejemplo.

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

La versión actual no hace desaparecer datos que hayan estado en versiones públicas antiguas. Antes del uso real se debe privatizar el repositorio y reescribir el historial o migrar a un repositorio privado limpio.

## Prueba de aceptación

No se debe declarar la aplicación lista para producción solamente porque el build sea exitoso. La prueba física debe cubrir GPS con pantalla bloqueada, cambio de aplicación, ahorro de batería, modo avión, recuperación de internet, dos teléfonos y restricciones reales del camión.

## Alojamiento

El repositorio no contiene instrucciones ni credenciales para una cuenta externa de Cloudflare. La aplicación conserva solamente los adaptadores internos necesarios para ejecutarse en el alojamiento administrado de ChatGPT Sites. Si se migra a otro proveedor, primero se debe implementar un reemplazo compatible para las API, secretos y base de datos.
