#!/bin/bash
echo "🚀 Iniciando Cloud-Termux em background..."

# Usar sempre o servidor adaptativo
if [ -f "server-adaptive.js" ]; then
    nohup node server-adaptive.js > cloud-termux.log 2>&1 &
    SERVER_FILE="server-adaptive.js"
else
    nohup node server.js > cloud-termux.log 2>&1 &
    SERVER_FILE="server.js"
fi

echo $! > cloud-termux.pid
echo "✅ Servidor iniciado em background (PID: $(cat cloud-termux.pid))"
echo "📱 Acesse: http://localhost:8080"
echo "👤 Login: admin / admin123"
echo "📋 Log: tail -f cloud-termux.log"
echo "🛑 Parar: kill $(cat cloud-termux.pid)"
echo "📄 Usando: $SERVER_FILE"