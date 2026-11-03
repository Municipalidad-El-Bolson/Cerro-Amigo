# Viabilidad, diseño y fases — 2026-11-03

## Alcance y planilla
La planilla PDF recibida de Mora contiene fecha, nombre y apellido, localidad, adultos, menores, JUBI/PENS y TOTAL. Es un formulario vacío, sin tarifas ni reglas de edad. La aplicación conserva esos campos; distingue cantidad de personas e importe ARS para evitar la ambigüedad de TOTAL. Fecha automática en zona America/Argentina/Salta. Una fila representa un grupo con un nombre de referencia, no una persona por fila. Confirmar esta interpretación antes del piloto.

Pantallas: ingreso, nuevo registro táctil, detalle con estados separados, historial con fechas/búsqueda, estadísticas, pendientes locales y administración de tarifas/usuarios/auditoría. No se recolectan DNI, datos de tarjetas ni nombres individuales de menores.

## Arquitectura
PWA responsive HTML/CSS/JS sin framework; backend monolítico Node 24 LTS con HTTP y SQLite nativos. Sin paquetes npm externos, microservicios ni infraestructura paga requerida para pruebas. SQLite en disco local, WAL y transacciones. Adecuado para un puesto o un número reducido de tablets contra un único servidor. No usar un archivo SQLite en una carpeta de red ni varias réplicas escribiendo copias distintas. Medir concurrencia antes de escalar; PostgreSQL sería una evolución si hiciera falta.

Modelo: users, sessions, settings (tarifas versionadas), visits (cantidades, importes en centavos, tarifa histórica, fechas, versión y estados), audit. No almacenar credenciales en Git. Las correcciones de identidad requieren administrador y motivo; las cantidades se corrigen anulando y registrando nuevamente mientras no haya pago. Registros pagados no se anulan ni reembolsan desde este MVP.

Estados independientes:
- Cola local: pendiente de sincronización; no representa registro confirmado.
- Registro: registered / cancelled.
- Pago: pending / paid (solo efectivo confirmado explícitamente).
- Fiscal: not_issued siempre; no existe endpoint de emisión ni impresión fiscal.
UUID por alta y huella de la solicitud: repetir exactamente un alta devuelve el mismo registro; reutilizar UUID con otros datos falla. Operaciones de efectivo son idempotentes. Actualizaciones verifican versión para evitar sobrescrituras. Auditoría y cambio se escriben juntos.

## Sin conexión
Con sesión abierta y tarifas previamente cargadas, un registro se guarda primero en almacenamiento local y luego se intenta enviar. Si se corta la red o se pierde la respuesta no se duplica. La cola está separada por cuenta; el usuario debe reconectar, autenticarse si venció y sincronizar. Un cambio de tarifa obliga a revisar el nuevo importe. No hay cobros ni fiscal offline. Límite: 500 pendientes por cuenta/tablet, antigüedad máxima admitida por servidor: 30 días. No se permite iniciar sesión offline ni recuperar una sesión cerrada sin servidor. No es almacenamiento cifrado: tablet de uso exclusivo, PIN, cifrado del dispositivo y política de retención obligatorios. El navegador puede desalojar almacenamiento: no es un respaldo. No borrar sus datos mientras existan pendientes. No existe sincronización en segundo plano con la app cerrada.

## Fuentes e integraciones
Consulta oficial realizada el 2026-11-03:
- https://www.mercadopago.com.ar/developers/es/docs/mp-point/overview (HTTP 200). Documenta Point Smart, cuenta de vendedor, aplicación, configuración de terminal, API unificada de órdenes, notificaciones, pruebas y salida a producción. No demuestra compatibilidad de un equipo todavía desconocido. La captura textual fue parcial; no se validaron aún endpoints, credenciales ni transacciones.
- https://www.mercadopago.com.ar/developers/es/docs/mp-point/create-application (enlace oficial de la página anterior, pendiente de revisión detallada).
- ARCA: las dos rutas intentadas para ayuda de controladores devolvieron 404. No se verificaron aún normativa actual, modelos homologados ni requisitos de integración. Consultar el portal oficial https://www.arca.gob.ar/ con el responsable fiscal y el proveedor del equipo antes de diseñar ese módulo. No inferir que imprimir un ticket equivale a emitir un comprobante fiscal.

Point y fiscal están bloqueados deliberadamente. Siguiente fase de pagos: confirmar terminal y cuenta institucional, documentación vigente, entorno de pruebas, claves por mecanismo seguro, idempotencia del proveedor, verificación de notificaciones y consulta servidor-servidor; conciliación y estados pendiente/error/expirado/reembolsado antes de producción. Nunca confirmar por pantalla de éxito del cliente. Pagos online son opcionales y requieren decisión institucional; no se agregan SDKs ni enlaces inventados.

## Datos pendientes para piloto
1. Tarifas oficiales, límites de edad, exenciones, si TOTAL en la planilla es importe o personas, permiso para cobrar en efectivo y reglas de cierre/corrección/reembolso.
2. Marca/modelo/firmware de Point y controlador fiscal, manual/protocolo/conectividad, responsable fiscal, condición tributaria, punto de venta y obligaciones aplicables. No enviar claves en chat.
3. Cantidad/modelo/SO de tablets, red, servidor, dominio/HTTPS, responsable de acceso y respaldos, retención de datos y usuarios iniciales. Validar el flujo en una tablet física.

## Fases y costos
A. MVP local: registro, tarifas, roles, historial, CSV compatible con Excel, estadísticas, pendientes y respaldo.
B. Piloto autorizado: HTTPS, tarifas reales, prueba física, capacitación, respaldo externo cifrado y restauración; revisión de seguridad y reglas operativas.
C. Point: solo después de verificar compatibilidad y contar con autorización/accesos de pruebas.
D. Fiscal: solo con equipo identificado, documentación y validación fiscal. Sin simulación de validez.

No se contrataron servicios ni se usaron APIs pagas. Costos externos pendientes de cotizar: servidor existente/nuevo, dominio/TLS si corresponde, respaldo, terminal/consumibles/controlador y soporte; comisiones/plazos de Mercado Pago dependen del contrato. No se estiman precios sin datos. La app no está desplegada en producción.
