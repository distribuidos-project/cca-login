// src/servidor.js
//
// cca-login: el puente de identidad. Recibe JSON del navegador y habla
// SOAP con cca-soap.
//
// Existe separado de cca-web porque son dos responsabilidades distintas:
// cca-web entrega archivos que nunca cambian; esto traduce protocolos y
// maneja credenciales. Es también el ÚNICO proceso del sistema, aparte
// de cca-soap, que ve una contraseña.
//
// NO sirve archivos estáticos. NO verifica tokens: no toma decisiones de
// autorización, solo transporta el token que emite cca-soap. Quien
// decide si un token permite leer un archivo es cca-repo, y él sí tiene
// la clave pública.

const express = require("express");
const QRCode = require("qrcode");
const config = require("./config");
const soapcli = require("./soap");

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------
// CORS. Hace falta porque el navegador carga la página desde cca-web y
// llama a este servicio, que está en otro origen. Mismo patrón que usa
// cca-repo: un solo origen permitido, configurable, nunca "*".
// ---------------------------------------------------------------------
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", config.origenPermitido);
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------
// Traduce un fallo SOAP a {codigo, mensaje}. CREDENCIALES_INVALIDAS no
// se desglosa a propósito: mismo mensaje para "usuario no existe" y
// "clave incorrecta", para no permitir enumerar cuentas.
// ---------------------------------------------------------------------
function traducirFalloSoap(e) {
  const falta = e?.root?.Envelope?.Body?.Fault;
  const codigo = falta?.faultcode || "ERROR";
  const mensajes = {
    CREDENCIALES_INVALIDAS: "Usuario o contraseña incorrectos",
    SEGUNDO_FACTOR_REQUERIDO: "Introduce el código de seis dígitos",
    SEGUNDO_FACTOR_INVALIDO: "El código no es válido",
    SIN_SEGUNDO_FACTOR: "Primero hay que registrar el segundo factor",
    USUARIO_BLOQUEADO: falta?.faultstring || "Cuenta bloqueada temporalmente",
    TOKEN_INVALIDO: "La sesión no es válida o expiró",
    USUARIO_INVALIDO: "Ese nombre de usuario no es válido",
    USUARIO_NO_EXISTE: "Ese usuario ya no existe",
  };
  return { codigo, mensaje: mensajes[codigo] || falta?.faultstring || "Error de autenticación" };
}

app.post("/api/login", async (req, res) => {
  const { usuario, clave, totp } = req.body || {};
  if (!usuario || !clave) {
    return res.status(400).json({ error: { codigo: "PETICION_INVALIDA", mensaje: "Falta usuario o clave" } });
  }
  try {
    const r = await soapcli.autenticar(usuario, clave, totp || "");
    res.json({ token: r.token, expiraEn: r.expiraEn, uid: r.uid, home: r.home, quota: r.quota });
  } catch (e) {
    console.error("=== fallo login ===");
    console.error("mensaje:", e && e.message);
    console.error("fault:", JSON.stringify(e?.root?.Envelope?.Body?.Fault, null, 2));
    console.error("===================");
    res.status(401).json({ error: traducirFalloSoap(e) });
  }
});

app.post("/api/renovar", async (req, res) => {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ error: { codigo: "PETICION_INVALIDA", mensaje: "Falta el token" } });
  }
  try {
    const r = await soapcli.renovarToken(token);
    res.json({ token: r.token, expiraEn: r.expiraEn });
  } catch (e) {
    res.status(401).json({ error: traducirFalloSoap(e) });
  }
});

app.post("/api/servicios", async (req, res) => {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ error: { codigo: "PETICION_INVALIDA", mensaje: "Falta el token" } });
  }
  try {
    const lista = await soapcli.mapaServicios(token);
    res.json(lista);
  } catch (e) {
    res.status(401).json({ error: traducirFalloSoap(e) });
  }
});

// ---------------------------------------------------------------------
// Segundo factor. Dos pasos a propósito: si se activara al registrar y
// el usuario escaneó mal el QR, quedaría fuera del sistema.
// ---------------------------------------------------------------------
app.post("/api/2fa/registrar", async (req, res) => {
  const { usuario, clave } = req.body || {};
  if (!usuario || !clave) {
    return res.status(400).json({ error: { codigo: "PETICION_INVALIDA", mensaje: "Falta usuario o clave" } });
  }
  try {
    const r = await soapcli.registrarSegundoFactor(usuario, clave);
    res.json({ uri: r.uri, semilla: r.semilla });
  } catch (e) {
    res.status(401).json({ error: traducirFalloSoap(e) });
  }
});

app.post("/api/2fa/confirmar", async (req, res) => {
  const { usuario, codigo } = req.body || {};
  if (!usuario || !codigo) {
    return res.status(400).json({ error: { codigo: "PETICION_INVALIDA", mensaje: "Falta usuario o código" } });
  }
  try {
    const r = await soapcli.confirmarSegundoFactor(usuario, codigo);
    res.json({ resultado: r.resultado });
  } catch (e) {
    res.status(401).json({ error: traducirFalloSoap(e) });
  }
});

app.get("/api/2fa/qr", async (req, res) => {
  const uri = req.query.uri;
  if (!uri) return res.status(400).send("Falta el parámetro uri");
  try {
    res.type("png");
    QRCode.toFileStream(res, uri, { width: 220, margin: 1 });
  } catch (e) {
    res.status(500).send("No se pudo generar el código QR");
  }
});

// Sonda de salud para cca-mon. Sin token.
app.get("/healthz", (req, res) => res.send("ok"));

// ---------------------------------------------------------------------
// Si el WSDL no carga, el proceso no arranca: sin cliente SOAP no hay
// login posible, y arrancar a medias es peor que fallar de inmediato.
// ---------------------------------------------------------------------
soapcli
  .iniciar()
  .then(() => {
    app.listen(config.puerto, () => {
      console.log(`cca-login escuchando en el puerto ${config.puerto}`);
      console.log(`WSDL: ${config.soapWsdlUrl}`);
      console.log(`Origen permitido (CORS): ${config.origenPermitido}`);
    });
  })
  .catch((e) => {
    console.error("No se pudo cargar el WSDL de cca-soap:", e.message);
    process.exit(1);
  });
