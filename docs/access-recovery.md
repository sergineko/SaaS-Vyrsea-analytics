# Passkeys y recuperación

En **Ajustes → Seguridad de acceso**, cada usuario puede registrar hasta cinco passkeys y generar un kit de ocho códigos de un solo uso. También puede abrir esta sección desde la pantalla de cuenta pendiente o suspendida. La capacidad de dominios y monitores del propietario no afecta a este límite de seguridad.

Antes de añadir una passkey o sustituir el kit se exige una autenticación WebAuthn con una clave de esa misma cuenta, verificación de usuario y desafío ligado a la sesión actual. La autorización dura cinco minutos y permite una sola operación. Una sesión robada por sí sola no permite generar códigos ni añadir claves.

El kit se muestra una sola vez y se puede descargar como texto. No se guarda en localStorage ni se envía por correo. Cada código contiene 128 bits aleatorios, además del prefijo de formato. D1 conserva únicamente SHA-256 del UUID del usuario y el código normalizado. Regenerar el kit invalida sus ocho códigos anteriores en una transacción. Guarda el archivo fuera del dispositivo de acceso y no lo subas al repositorio ni a tickets de soporte.

## Si se pierde una passkey

1. Prueba primero otra passkey registrada o la copia sincronizada de tu gestor.
2. Si no tienes ninguna, abre **Iniciar sesión → He perdido mi passkey · Recuperar acceso**.
3. Introduce tu usuario y uno de tus códigos, completa Turnstile y registra personalmente una nueva passkey.
4. La transacción sustituye todas las passkeys, revoca todas las sesiones anteriores y consume únicamente el código utilizado. Los siete restantes siguen disponibles; puedes generar un kit nuevo tras confirmar la nueva passkey.

La recuperación conserva el UUID, monitores, histórico, rol y plan. Una cuenta pendiente sigue pendiente y una suspendida necesita reactivación del propietario. También se aplica la suspensión por inactividad si el plazo Free ya ha vencido. La recuperación no es un mecanismo de aprobación.

El desafío caduca a los cinco minutos y se consume antes de verificar la respuesta. Los cambios en claves, sesiones y código se confirman en un único batch D1 con condiciones sobre el código todavía disponible. Dos peticiones simultáneas con el mismo código solo permiten una recuperación. Un fallo de attestation no consume el código ni modifica las claves. Las escrituras de passkeys adicionales y kits también comprueban que su sesión siga vigente.

## Límites y operación

- Turnstile exige la acción `recover`, hostname final y token válido. Solo localhost permite prescindir de él.
- Las rutas usan HTTPS, origen exacto, JSON, cookies HttpOnly/SameSite Strict, respuestas no-store, límites de tamaño y frecuencia. No se devuelven hashes ni códigos en los resúmenes de seguridad.
- No existe restablecimiento automático por correo ni un botón administrativo que cambie una passkey sin verificar la identidad. Falta configurar un canal de email verificado y sus notificaciones de seguridad.
- Si se pierden todas las passkeys y todos los códigos, se puede solicitar [recuperación asistida en el CRM](support-crm.md). Requiere verificar la titularidad, autorización del propietario con passkey y un enlace de un solo uso. No se aplica a cuentas propietarias ni con permiso global de soporte. No existe recuperación automática por correo.
- No se generan kits desde scripts de administración ni durante el despliegue. El titular confirma su passkey y guarda su kit personalmente en el dominio definitivo.
- No se copian claves privadas: se registra una credencial nueva. La ceremonia real depende del dispositivo, navegador o llave del usuario.

Pruebas en `tests/recovery.test.ts`: firmas ES256 reales, prueba reciente y ligada a sesión, rotación, hashes, passkey adicional, revocación de claves y sesiones, concurrencia, caducidad, origen, límites de intentos y conservación de estados de aprobación.

Referencias: [WebAuthn](https://www.w3.org/TR/webauthn-3/) y [OWASP sobre recuperación y cambios de factores](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).
