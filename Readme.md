# cca-login — Puente de identidad

Nodo del sistema distribuido UPB-CIENTÍFICA.

## Qué hace

Traduce JSON del navegador a SOAP contra `cca-soap`. Es lo único que
hace: recibe credenciales, llama a `cca-soap`, y devuelve el token.

Existe separado de `cca-web` porque son dos responsabilidades sin
relación entre sí: `cca-web` entrega archivos estáticos que nunca
cambian; esto traduce protocolos y maneja credenciales.

**Es el único proceso del sistema, aparte de `cca-soap`, que ve una
contraseña.** Eso lo convierte en una máquina de confianza y hay que
tratarlo como tal.

## Lo que NO hace, a propósito

- **No sirve archivos estáticos.** Eso es de `cca-web`.
- **No verifica tokens.** No toma decisiones de autorización: solo
  transporta el token que emite `cca-soap`. Quien decide si un token
  permite leer un archivo es `cca-repo`, y él sí tiene la clave pública.
  Por eso aquí **no hace falta `jwt-public.pem`**.
- **No habla con `cca-repo`.** El navegador lo hace directo.

## Conexiones

| Origen → Destino | Protocolo | Puerto |
|---|---|---|
| Navegador → `cca-login` | HTTP/JSON | 8081 |
| `cca-login` → `cca-soap` | SOAP 1.1 (RPC/encoded) | 80 |

Una entrada, una salida. Ningún otro módulo lo llama.

## Rutas

| Ruta | Método | Qué hace |
|---|---|---|
| `/api/login` | POST | `{usuario, clave, totp}` → token, uid, home, quota |
| `/api/renovar` | POST | `{token}` → token nuevo |
| `/api/servicios` | POST | `{token}` → mapa de servicios (dónde está `cca-repo`) |
| `/api/2fa/registrar` | POST | `{usuario, clave}` → uri `otpauth://`, semilla |
| `/api/2fa/confirmar` | POST | `{usuario, codigo}` → activa el segundo factor |
| `/api/2fa/qr` | GET | `?uri=` → imagen PNG del código QR |
| `/healthz` | GET | Sonda para `cca-mon`. Sin token |

## Estructura

```
cca-login/
├── package.json
├── .gitignore
└── src/
    ├── servidor.js   rutas /api/*, CORS, arranque
    ├── soap.js        cliente de cca-soap (las 5 operaciones que se usan)
    └── config.js       puerto, WSDL y origen permitido, por variables de entorno
```

## Arrancar

```bash
npm install
SOAP_WSDL_URL=http://<host-de-cca-soap>/usuarios.wsdl \
PUERTO=8081 \
ORIGEN_PERMITIDO=http://localhost:8080 \
node src/servidor.js
```

| Variable | Para qué | Por defecto |
|---|---|---|
| `SOAP_WSDL_URL` | Dónde está el contrato de `cca-soap` | `http://cca-soap/usuarios.wsdl` |
| `PUERTO` | Puerto de escucha | `8081` |
| `ORIGEN_PERMITIDO` | Origen del navegador autorizado (CORS) | `http://cca-web` |

Si el WSDL no carga, **el proceso no arranca**. Es a propósito: sin
cliente SOAP no hay login posible, y arrancar a medias es peor que
fallar de inmediato.

## CORS: por qué hace falta

El navegador carga la página desde `cca-web` y llama a este servicio,
que está en otro origen. Sin CORS explícito, el navegador bloquea la
llamada.

Se usa **el mismo patrón que `cca-repo`**: un solo origen permitido,
configurable, nunca `*`. Si el valor de `ORIGEN_PERMITIDO` no coincide
exactamente con el origen desde el que se sirve la página (protocolo,
host y puerto), el login fallará sin mensaje claro en el servidor — el
error se ve solo en la consola del navegador.

## Probar

```bash
# login
curl -X POST http://localhost:8081/api/login \
  -H 'Content-Type: application/json' \
  -d '{"usuario":"jperez","clave":"pipipopo","totp":""}'

# con el token que devuelve
curl -X POST http://localhost:8081/api/servicios \
  -H 'Content-Type: application/json' -d '{"token":"<token>"}'

# que las cabeceras CORS salgan
curl -i -X OPTIONS http://localhost:8081/api/login \
  -H 'Origin: http://localhost:8080' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

La última es la que suele fallar sin que se note: el navegador manda ese
`OPTIONS` (preflight) antes de cualquier POST con
`Content-Type: application/json`. Debe responder `204` con las tres
cabeceras `Access-Control-*`.

## Decisiones

| Decisión | Razón |
|---|---|
| Separado de `cca-web` | Servir estáticos y traducir protocolos son responsabilidades distintas; además aísla el único proceso que ve contraseñas |
| No verifica tokens ni tiene la clave pública | No toma decisiones de autorización. Tenerla daría la falsa impresión de que aquí se controla el acceso, cuando el control real está en `cca-repo` |
| CORS con origen configurable, nunca `*` | Mismo patrón que `cca-repo` ya usa; no se introduce un mecanismo nuevo al sistema |
| `desenvolver()` genérico en `soap.js` | El WSDL real anota cada valor con `xsi:type` y envuelve la respuesta en un campo `resultado`; se deshace de forma genérica sin asumir nombres de campo |
| `CREDENCIALES_INVALIDAS` no se desglosa | Mismo mensaje para usuario inexistente y clave incorrecta, para no permitir enumerar cuentas |
| El segundo factor se activa en dos pasos | Si se activara al registrar y el usuario escaneó mal el QR, quedaría fuera del sistema |
| El QR se genera aquí, no en el navegador | Evita una dependencia de generación de códigos QR en el cliente |

## Aviso de seguridad

Este servicio recibe contraseñas en claro desde el navegador y las
reenvía a `cca-soap`. En el laboratorio viaja sin HTTPS, igual que el
resto del sistema — riesgo aceptado y documentado. En producción, tanto
la conexión navegador → `cca-login` como `cca-login` → `cca-soap`
deberían ir cifradas.