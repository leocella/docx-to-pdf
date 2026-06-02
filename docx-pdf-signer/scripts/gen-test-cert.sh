#!/usr/bin/env bash
# Gera um certificado AUTOASSINADO de teste (NUNCA usar em produção).
# Útil para testar o fluxo de assinatura sem um certificado A1 real.
set -euo pipefail
PASS="${1:-teste123}"
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes \
  -subj "/C=BR/ST=SC/L=Blumenau/O=Teste/CN=Assinatura Teste" \
  -addext "keyUsage=critical,nonRepudiation,digitalSignature"
openssl pkcs12 -export -out test-cert.pfx -inkey key.pem -in cert.pem -passout "pass:${PASS}"
rm -f key.pem cert.pem
echo "Gerado test-cert.pfx (senha: ${PASS})"
