# Verificación local — 2026-11-03

Entorno observado: Linux, Node 24.22.1, SQLite 3.53.4, Firefox 154 headless. Solo datos sintéticos, cuentas temporales y SQLite de prueba. No se usaron credenciales reales ni se enviaron pagos.

- npm run check: sintaxis de backend, capa de datos, cliente y service worker correcta.
- npm test: **12/12 pruebas de integración aprobadas**, sin omisiones. Cada prueba cubre varias aserciones; no es una cifra de cobertura de líneas.
- python3 scripts/ui-smoke.py: aprobado en Firefox aislado. Login, configuración de tarifas sintéticas, alta, detalle, confirmación manual de efectivo, historial y estadísticas. Ventanas de 1024 y 390 px sin desborde horizontal. Corte real del proceso backend con sesión abierta: alta retenida en la tablet; servidor reiniciado, sincronización correcta, dos registros finales (uno online y uno pendiente) sin duplicación.
- Respaldo con la API SQLite: integridad, cantidad de registros y auditoría verificados sobre la copia; evita sobrescribir destinos existentes.
- Captura inspeccionada: [interfaz de registro](captura-tablet.png). Las tarifas visibles son **datos de prueba**, no tarifas de la reserva.

Reproducir: npm run check && npm test. Para UI, Python 3 y Firefox instalados: python3 scripts/ui-smoke.py. El script abre un perfil temporal separado (usa ~/snap/firefox/common cuando corresponde), inicia un servidor solo loopback en un puerto disponible, crea contraseña efímera y elimina DB/perfil al finalizar. No toca el perfil personal ni mantiene servidores de prueba activos. Regenera la captura; revisarla antes de agregar cambios a Git.

No verificado: instalación PWA en tablet física Android/iPad, dispositivos/impresión, Mercado Pago, fiscal/ARCA, carga sostenida, infraestructura HTTPS real, recuperación de desastre externa y operación institucional. La prueba con backend caído no certifica todas las condiciones offline del navegador ni supervivencia a desalojo del almacenamiento. Esas comprobaciones forman parte del piloto autorizado. No hay certificación de seguridad ni fiscal.
