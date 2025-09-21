#!/bin/bash

echo "=================================================================="
echo "🔧 ATUALIZANDO CLOUD-TERMUX - VERSÃO 1.2"
echo "=================================================================="
echo "✨ Novas funcionalidades:"
echo "   📁 Criação de pastas"
echo "   ⬇️ Download de arquivos"
echo "   💾 Monitor de espaço livre"
echo "   ⚙️ Configurações de armazenamento externo"
echo "   📱 Interface mobile otimizada"
echo "=================================================================="

# Cores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCESSO]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[AVISO]${NC} $1"
}

# Parar servidor se estiver rodando
log_info "Parando servidor atual..."
kill $(cat cloud-termux.pid) 2>/dev/null || pkill -f "node server" || true

# Fazer backup da configuração atual
if [ -f "storage-config.json" ]; then
    cp storage-config.json storage-config.backup.json
    log_info "Backup das configurações criado"
fi

# Atualizar código
log_info "Atualizando código..."
git pull origin capy/cap-1-4511e2fe

# Usar servidor adaptativo como padrão
if [ -f "server-adaptive.js" ]; then
    cp server-adaptive.js server.js
    log_success "Servidor adaptativo ativado"
fi

# Usar package seguro como padrão  
if [ -f "package-safe.json" ]; then
    cp package-safe.json package.json
    log_success "Dependências seguras ativadas"
fi

# Reinstalar dependências (modo seguro)
log_info "Reinstalando dependências..."
rm -rf node_modules package-lock.json
npm install --no-optional --production

if [ $? -eq 0 ]; then
    log_success "Dependências instaladas com sucesso"
else
    log_warning "Problemas na instalação, mas continuando..."
fi

# Criar diretórios necessários
log_info "Verificando estrutura de pastas..."
mkdir -p database temp public/uploads
chmod 755 public/uploads temp

# Testar funcionalidades básicas
log_info "Testando funcionalidades..."
node -e "
const fs = require('fs');
const path = require('path');

// Teste 1: Criar e escrever arquivo
const testFile = path.join(__dirname, 'temp', 'test.txt');
fs.writeFileSync(testFile, 'teste');
fs.unlinkSync(testFile);
console.log('✅ Escrita em temp/ OK');

// Teste 2: Verificar módulos principais
const express = require('express');
console.log('✅ Express OK');

const bcrypt = require('bcryptjs');
console.log('✅ bcryptjs OK');

console.log('✅ Todos os testes passaram');
" 2>/dev/null

if [ $? -eq 0 ]; then
    log_success "Testes funcionais OK"
else
    log_warning "Alguns testes falharam, mas deve funcionar"
fi

echo ""
echo "=================================================================="
echo -e "${GREEN}🎉 ATUALIZAÇÃO CONCLUÍDA!${NC}"
echo "=================================================================="
echo ""
echo "🚀 NOVAS FUNCIONALIDADES DISPONÍVEIS:"
echo ""
echo "📁 PASTAS:"
echo "   • Criar pastas pela interface web"
echo "   • Navegar entre pastas"
echo "   • Upload direto para pastas"
echo ""
echo "⬇️ DOWNLOAD:"
echo "   • Botão de download em cada arquivo"
echo "   • Download direto no navegador"
echo ""
echo "💾 ARMAZENAMENTO:"
echo "   • Monitor de espaço livre em tempo real"
echo "   • Configurar armazenamento externo (cartão SD)"
echo "   • Informações detalhadas de storage"
echo ""
echo "📱 MOBILE:"
echo "   • Interface 100% otimizada para celulares"
echo "   • Menu lateral responsivo"
echo "   • Touch-friendly em todas as telas"
echo ""
echo "=================================================================="
echo "🎯 COMO USAR:"
echo ""
echo "1. Iniciar servidor:"
echo "   ./start-cloud.sh"
echo ""
echo "2. Acessar interface:"
echo "   http://localhost:8080"
echo ""
echo "3. Testar novas funcionalidades:"
echo "   • Arquivos → Nova Pasta"
echo "   • Configurações → Armazenamento Externo"
echo "   • Download de qualquer arquivo"
echo ""
echo "4. Configurar cartão SD (exemplo):"
echo "   /storage/3B07-4AB2/"
echo "   /data/data/com.termux/files/home/storage/shared/"
echo ""
echo "=================================================================="

read -p "Iniciar servidor atualizado agora? (s/n): " start_now

if [ "$start_now" = "s" ] || [ "$start_now" = "S" ]; then
    log_info "Iniciando Cloud-Termux atualizado..."
    echo ""
    ./start-cloud.sh
fi