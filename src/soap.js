// src/soap.js
//
// PASO 2: autenticar, para el login.
// PASO 3: renovarToken y mapaServicios.
//
// CORRECCIÓN (verificado contra cca-soap real): el WSDL anota cada valor
// con su tipo (xsi:type), así que la librería SOAP no entrega escalares
// planos — cada campo llega como {attributes:{...}, "$value": <valor>},
// y el resultado completo viene envuelto en un campo contenedor llamado
// "resultado". `desenvolver()` deshace las dos cosas, sin asumir los
// nombres exactos de cada campo (solo la forma {attributes, $value}).

const soap = require("soap");
const config = require("./config");

let cliente = null;

// Se crea UNA vez al arrancar. Si el WSDL no carga, el proceso no debe
// arrancar: sin cliente SOAP no hay login posible (PARTE 5.2).
async function iniciar() {
  cliente = await soap.createClientAsync(config.soapWsdlUrl);
  return cliente;
}

function comprobarListo() {
  if (!cliente) {
    throw new Error("El cliente SOAP no se ha inicializado todavía");
  }
}

// Deshace la anotación de tipos de la respuesta SOAP real:
//   {attributes:{xsi:type:...}, "$value": "abc"}  ->  "abc"
// de forma recursiva, en cualquier nivel de anidación. Si la respuesta
// NO viene anotada así (como en pruebas con un WSDL más simple), esta
// función no cambia nada — es un no-op seguro.
function desenvolver(x) {
  if (x === null || x === undefined) return x;
  if (Array.isArray(x)) return x.map(desenvolver);
  if (typeof x === "object") {
    if ("$value" in x) return desenvolver(x.$value);
    const limpio = {};
    for (const [k, v] of Object.entries(x)) {
      if (k === "attributes") continue;
      limpio[k] = desenvolver(v);
    }
    return limpio;
  }
  return x;
}

async function autenticar(usuario, clave, totp = "") {
  comprobarListo();
  const [r] = await cliente.autenticarAsync({ usuario, clave, totp });
  const d = desenvolver(r);
  return d.resultado || d; // { token, expiraEn, uid, home, quota }
}

async function renovarToken(token) {
  comprobarListo();
  const [r] = await cliente.renovarTokenAsync({ token });
  const d = desenvolver(r);
  return d.resultado || d; // { token, expiraEn }
}

async function registrarSegundoFactor(usuario, clave) {
  comprobarListo();
  const [r] = await cliente.registrarSegundoFactorAsync({ usuario, clave });
  const d = desenvolver(r);
  return d.resultado || d; // { uri, semilla }
}

async function confirmarSegundoFactor(usuario, codigo) {
  comprobarListo();
  const [r] = await cliente.confirmarSegundoFactorAsync({ usuario, codigo });
  const d = desenvolver(r);
  const contenedor = d.resultado ?? d;
  // RespuestaSimple (el tipo real del WSDL) tiene un campo interno que
  // TAMBIÉN se llama "resultado" — tras quitar el sobre del mensaje debería
  // quedar un objeto {resultado: "OK"}. Se cubre también el caso de que
  // llegue ya aplanado a un string directo, sin asumir una única forma.
  const valor = typeof contenedor === "object" && contenedor !== null ? contenedor.resultado : contenedor;
  return { resultado: valor };
}

async function mapaServicios(token) {
  comprobarListo();
  const [r] = await cliente.mapaServiciosAsync({ token });
  const d = desenvolver(r);
  return normalizarMapaServicios(d);
}

// Combina dos cosas defensivamente: el contenedor "resultado"/"servicio"
// que usa el cca-soap real, y la posibilidad de que la respuesta venga
// además envuelta en un array de un solo elemento (visto con distintas
// implementaciones de servidor SOAP). Se navega sin asumir una única
// forma, en vez de fallar si la anidación no es la esperada.
function normalizarMapaServicios(x) {
  let actual = x;
  for (let i = 0; i < 4 && actual != null; i++) {
    if (Array.isArray(actual)) {
      if (actual.length && actual[0] && typeof actual[0] === "object" && "nombre" in actual[0]) {
        return actual;
      }
      actual = actual[0];
      continue;
    }
    if (typeof actual === "object") {
      if ("resultado" in actual) { actual = actual.resultado; continue; }
      if ("servicio" in actual) { actual = actual.servicio; continue; }
      if ("nombre" in actual) return [actual];
    }
    break;
  }
  return Array.isArray(actual) ? actual : [];
}

module.exports = { iniciar, autenticar, renovarToken, mapaServicios, registrarSegundoFactor, confirmarSegundoFactor };
