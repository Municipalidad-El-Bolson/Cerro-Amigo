Monika, necesito desarrollar una aplicación para tablets destinada a la Reserva Natural Cerro Amigo, en El Bolsón.

**Objetivo:** reemplazar la planilla manual de visitantes por un sistema de registro, cobro de entradas y emisión de comprobantes fiscales, con una interfaz táctil rápida y sencilla.

**Funciones requeridas:**

1. Registro de fecha automática, nombre y apellido, localidad de procedencia y cantidades de adultos, menores y jubilados/pensionados.
2. Tarifas editables por categoría y cálculo automático del total.
3. Base de datos persistente con historial, búsqueda, edición controlada y exportación a CSV/Excel.
4. Usuarios con roles de operador y administrador, autenticación y registro de modificaciones.
5. Dashboard con visitantes e ingresos por día, mes, procedencia, categoría y medio de pago.
6. Cobros en efectivo, Mercado Pago Point y, si conviene, pagos online. Integrar únicamente métodos compatibles y confirmados mediante API oficial.
7. Vinculación con el controlador fiscal nuevo para emitir comprobantes válidos, solamente después de verificar marca, modelo, protocolo y requisitos de ARCA.
8. Estados independientes para registro, pago y comprobante fiscal; contemplar errores, reintentos seguros y evitar duplicaciones.

**Arquitectura:** priorizá una PWA responsive para tablets, con backend y base de datos. Elegí un stack sencillo, seguro y fácil de mantener. No crees microservicios ni aplicaciones nativas sin necesidad. Considerá cortes de internet: permitir registros pendientes si es viable, sin confirmar cobros ni facturas sin validación.

**Metodología de trabajo:**

- Primero revisá la planilla adjunta y diseñá las pantallas y el modelo de datos.
- Investigá la documentación oficial actual de Mercado Pago Point y los requisitos del controlador fiscal.
- Informame los datos y accesos de hardware faltantes, riesgos, costos externos y alternativas.
- Proponé un MVP con registro, tarifas, base de datos y estadísticas.
- Después implementá pagos y facturación por módulos, cuando estén verificadas las compatibilidades.
- Reutilizá componentes, evitá dependencias y código innecesarios, y trabajá con instrucciones compactas para ahorrar tokens.
- No inventes integraciones, no uses credenciales reales en pruebas y no pongas nada en producción sin mi autorización.

**Entregables:** código fuente, instrucciones de instalación, aplicación operativa en tablet, pruebas, respaldo de base de datos y documentación breve.

Empezá con el análisis de viabilidad, arquitectura, fases y datos faltantes. No desarrolles todavía la integración fiscal sin conocer el equipo.