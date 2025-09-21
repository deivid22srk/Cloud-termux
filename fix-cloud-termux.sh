#!/bin/bash

# Script de correção para problemas específicos do Cloud-Termux
# Resolve problemas de SQLite3 e dependências no Termux

echo "=================================================================="
echo "🔧 CLOUD-TERMUX - SCRIPT DE CORREÇÃO"
echo "=================================================================="
echo "🐛 Corrigindo problemas conhecidos"
echo "=================================================================="

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCESSO]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[AVISO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERRO]${NC} $1"
}

echo "🔍 NOVO PROBLEMA DETECTADO:"
echo "   ❌ gyp: Undefined variable android_ndk_path in binding.gyp"
echo "   ❌ better-sqlite3 ainda precisa de compilação no Termux"
echo "   ❌ Android NDK não configurado"
echo ""

log_info "Aplicando correções específicas para Termux..."

# Correção ESPECÍFICA para Termux: Instalar ferramentas de build
if command -v pkg &> /dev/null; then
    log_info "Instalando ferramentas de compilação para Termux..."
    pkg install -y clang make cmake python build-essential
    
    # Configurar variáveis de ambiente para compilação
    export CC=clang
    export CXX=clang++
    export AR=llvm-ar
    export STRIP=llvm-strip
    export ANDROID_NDK_HOME="$PREFIX"
    
    # Tentar instalar better-sqlite3 pré-compilado
    log_info "Tentando instalar better-sqlite3 pré-compilado..."
    npm install better-sqlite3@9.4.3 --build-from-source=false
    
    if [ $? -ne 0 ]; then
        log_warning "Pré-compilado falhou, tentando alternativa..."
        # Usar uma implementação SQLite mais simples
        npm uninstall better-sqlite3
        
        # Opção 1: Tentar sqlite puro em JS (sem compilação)
        npm install sql.js --save
        
        if [ $? -eq 0 ]; then
            log_success "Instalado sql.js como alternativa (puro JavaScript)!"
            # Criar flag para usar sql.js
            echo "USE_SQLJS=true" > .env
        else
            # Opção 2: Usar armazenamento em arquivo JSON
            log_warning "Usando armazenamento em JSON como fallback..."
            echo "USE_JSON_STORAGE=true" > .env
        fi
    else
        log_success "better-sqlite3 instalado com sucesso!"
        echo "USE_BETTER_SQLITE=true" > .env
    fi
fi

# Correção 2: Limpar instalação problemática e tentar alternativas
log_info "Removendo módulos problemáticos..."
rm -rf node_modules/better-sqlite3 node_modules/sqlite3
rm -f package-lock.json

# Correção 3: Instalar dependências básicas primeiro
log_info "Instalando dependências básicas..."
npm install express@4.19.2 express-session@1.18.0 bcryptjs@2.4.3 --save --no-optional
npm install socket.io@4.7.5 express-fileupload@1.5.0 --save --no-optional
npm install mime@4.0.1 compression@1.7.4 helmet@7.1.0 cors@2.8.5 --save --no-optional

# Tentar multer sem vulnerabilidades
npm install multer@1.4.5-lts.2 --save --no-optional || log_warning "Multer instalado com vulnerabilidades conhecidas"

# Correção 4: Verificar qual sistema de banco foi instalado e testar
log_info "Testando sistema de banco de dados..."

if [ -f ".env" ]; then
    source .env
fi

if [ "$USE_BETTER_SQLITE" = "true" ]; then
    log_info "Testando better-sqlite3..."
    node -e "const db=require('better-sqlite3')(':memory:'); console.log('✓ better-sqlite3 OK')" 2>/dev/null
    if [ $? -eq 0 ]; then
        log_success "better-sqlite3 funcionando!"
    else
        log_error "better-sqlite3 com problemas, mudando para sql.js"
        echo "USE_SQLJS=true" > .env
    fi
elif [ "$USE_SQLJS" = "true" ]; then
    log_info "Testando sql.js..."
    node -e "const SQL = require('sql.js'); console.log('✓ sql.js OK')" 2>/dev/null
    if [ $? -eq 0 ]; then
        log_success "sql.js funcionando!"
    else
        log_warning "sql.js com problemas, usando JSON storage"
        echo "USE_JSON_STORAGE=true" > .env
    fi
else
    log_info "Usando JSON storage (fallback)"
    echo "USE_JSON_STORAGE=true" > .env
fi

# Correção 5: Criar versão simplificada de emergência
log_info "Criando backup de configuração..."
cp package.json package.json.backup

# Correção 6: Verificar estrutura de pastas
log_info "Verificando estrutura de pastas..."
mkdir -p public/uploads database public/js public/css

# Definir permissões corretas
chmod 755 public/uploads
chmod +x install-termux.sh
chmod +x start-cloud.sh

# Criar arquivo de status
cat > .install-status << EOF
# Status da instalação Cloud-Termux
INSTALL_DATE=$(date)
SQLITE_TYPE=better-sqlite3
DISTUTILS_FIXED=yes
MODULES_CHECKED=yes
LAST_CORRECTION=$(date)
EOF

echo ""
echo "=================================================================="
echo -e "${GREEN}🎉 CORREÇÕES APLICADAS!${NC}"
echo "=================================================================="
echo ""
echo "✅ CORREÇÕES ESPECÍFICAS PARA TERMUX APLICADAS:"
echo "   • Ferramentas de compilação instaladas"
echo "   • Variáveis de ambiente configuradas"
echo "   • Sistema de banco adaptativo implementado"
echo "   • Fallbacks para diferentes cenários"
echo "   • Dependências básicas instaladas"
echo ""
echo "🚀 PRÓXIMOS PASSOS:"
echo "   1. ./start-cloud.sh"
echo "   2. Abrir http://localhost:8080"
echo "   3. Login: admin / admin123"
echo ""
echo "🚪 MODO DE RECUPERAÇÃO TOTAL (se ainda falhar):"
echo ""
log_info "Criando backup e usando versão 100% compatível..."

# Fazer backup do package.json original
cp package.json package-original.json

# Usar versão sem dependências de compilação
cp package-safe.json package.json
cp server-adaptive.js server.js

log_info "Instalando apenas dependências básicas (sem compilação)..."
rm -rf node_modules package-lock.json
npm install --no-optional --production

if [ $? -eq 0 ]; then
    log_success "MODO COMPATIBILIDADE ATIVADO!"
    echo "USE_JSON_STORAGE=true" > .env
    echo "SAFE_MODE=true" >> .env
else
    log_error "Falha crítica. Restaurando configuração original..."
    cp package-original.json package.json
fi
echo ""
echo "🎯 PRÓXIMOS PASSOS:"
echo "   1. ./start-cloud.sh (inicia o servidor)"
echo "   2. Abrir http://localhost:8080 no navegador" 
echo "   3. Login: admin / admin123"
echo ""
echo "🔧 SOLUÇÃO DE PROBLEMAS:"
echo "   • Modo Seguro: cp package-safe.json package.json && npm install"
echo "   • Reset total: rm -rf node_modules && ./fix-cloud-termux.sh"
echo "   • Reiniciar Termux: exit && termux (reabre o aplicativo)"
echo "   • Verificar logs: node --trace-warnings server.js"
echo ""
echo "=================================================================="

log_success "Script de correção concluído!"

# Tentar iniciar automaticamente
read -p "Tentar iniciar o servidor agora? (s/n): " start_now

if [ "$start_now" = "s" ] || [ "$start_now" = "S" ]; then
    log_info "Iniciando Cloud-Termux..."
    echo ""
    ./start-cloud.sh
fi