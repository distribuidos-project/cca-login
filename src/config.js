// src/config.js
//
// Toda dirección sale de una variable de entorno.

module.exports = {
  puerto: parseInt(process.env.PUERTO || "8081", 10),

  // Punto de entrada al plano de identidad. Es de las pocas direcciones
  // que sí hace falta escribir en algún sitio: sin token todavía no se
  // puede consultar el mapa de servicios.
  soapWsdlUrl: process.env.SOAP_WSDL_URL || "http://cca-soap/usuarios.wsdl",

  // Origen del navegador que puede llamar a este servicio. Mismo patrón
  // que la opción -origen de cca-repo: al estar cca-web y cca-login en
  // orígenes distintos, el navegador exige CORS explícito.
  //
  // En desarrollo local suele ser http://localhost:8080.
  origenPermitido: process.env.ORIGEN_PERMITIDO || "http://cca-web",
};
