#!/bin/bash

echo "🚀 Iniciando Cloud-Termux..."
echo "📱 Acesse: http://localhost:8080"
echo "👤 Login: admin / admin123"
echo ""

# Usar sempre o servidor adaptativo para compatibilidade total
if [ -f "server-adaptive.js" ]; then
    echo "✅ Usando servidor adaptativo (compatibilidade total)"
    node server-adaptive.js
elif [ -f "server.js" ]; then
    echo "⚠️ Usando servidor padrão"
    node server.js
else
    echo "❌ Arquivo do servidor não encontrado!"
    echo "Execute: npm install && ./fix-cloud-termux.sh"
    exit 1
fi