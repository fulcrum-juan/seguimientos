# Seguimiento Fulcrum

Página de seguimiento de Ventas y Soporte de clubes.

- `index.html`: la página (Ventas, Soporte, Configuración).
- `sb-shim.js`: conexión con Supabase (login con email y contraseña, base de datos en vivo).

Los datos viven en Supabase (proyecto `ymwdrelkuqkjzrkyslge`, tabla `docs`) y están protegidos por login y reglas de seguridad: sin usuario autorizado no se ve nada. La clave que aparece en `sb-shim.js` es la clave pública de Supabase, pensada para ir en el navegador.

Usuarios: se gestionan en la página, en Configuración → Usuarios (solo administradores).
