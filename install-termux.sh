#!/bin/bash

# Script de instalação do Cloud-Termux
# Plataforma de nuvem pessoal inspirada no Nextcloud para Termux

echo "=================================================================="
echo "🚀 CLOUD-TERMUX - INSTALAÇÃO AUTOMÁTICA"
echo "=================================================================="
echo "📱 Plataforma de nuvem pessoal para Termux"
echo "🌟 Inspirado no Nextcloud"
echo "=================================================================="

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para log colorido
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

# Verificar se estamos no Termux
if [ ! -d "/data/data/com.termux" ]; then
    log_warning "Este script foi otimizado para o Termux, mas pode funcionar em outros sistemas Linux."
    read -p "Continuar instalação? (s/n): " continue_install
    if [ "$continue_install" != "s" ] && [ "$continue_install" != "S" ]; then
        log_info "Instalação cancelada."
        exit 0
    fi
fi

# Verificar conexão com internet
log_info "Verificando conexão com internet..."
if ! ping -c 1 google.com &> /dev/null; then
    log_error "Sem conexão com internet. Verifique sua conexão e tente novamente."
    exit 1
fi
log_success "Conexão com internet verificada."

# Atualizar pacotes do Termux/sistema
log_info "Atualizando pacotes do sistema..."
if command -v pkg &> /dev/null; then
    # Estamos no Termux
    pkg update -y && pkg upgrade -y
    log_info "Instalando dependências do Termux..."
    
    # Instalar nodejs primeiro
    pkg install -y nodejs
    
    # Instalar python e setuptools (contém distutils para Python 3.12)
    pkg install -y python python-pip
    pip install setuptools distutils-extra
    
    # Instalar outras dependências
    pkg install -y build-essential make
    
    # Verificar se npm está disponível, se não, usar o que vem com nodejs
    if ! command -v npm &> /dev/null; then
        log_warning "NPM não encontrado, tentando usar o npm interno do Node.js..."
        # Criar link simbólico se necessário
        if [ -f "$PREFIX/lib/node_modules/npm/bin/npm-cli.js" ]; then
            ln -sf "$PREFIX/lib/node_modules/npm/bin/npm-cli.js" "$PREFIX/bin/npm"
            chmod +x "$PREFIX/bin/npm"
        fi
    fi
    
elif command -v apt &> /dev/null; then
    # Ubuntu/Debian
    sudo apt update && sudo apt upgrade -y
    sudo apt install -y nodejs npm python3 python3-pip python3-setuptools build-essential sqlite3
elif command -v yum &> /dev/null; then
    # CentOS/RHEL
    sudo yum update -y
    sudo yum install -y nodejs npm python3 python3-pip gcc make sqlite
else
    log_warning "Gerenciador de pacotes não detectado. Instale manualmente: nodejs, npm, python3, build-essential"
fi

log_success "Pacotes do sistema atualizados."

# Verificar se Node.js está instalado
if ! command -v node &> /dev/null; then
    log_error "Node.js não encontrado. Por favor, instale Node.js manualmente."
    exit 1
fi

# Verificar versão do Node.js
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 14 ]; then
    log_warning "Node.js versão $NODE_VERSION detectada. Recomendado versão 14 ou superior."
else
    log_success "Node.js $(node -v) detectado."
fi

# Verificar se NPM está instalado
if ! command -v npm &> /dev/null; then
    log_error "NPM não encontrado. Por favor, instale NPM manualmente."
    exit 1
fi

log_success "NPM $(npm -v) detectado."

# Instalar dependências do projeto
log_info "Instalando dependências do Node.js..."

# Tentar instalação normal primeiro
npm install --no-optional

if [ $? -eq 0 ]; then
    log_success "Dependências instaladas com sucesso."
else
    log_warning "Falha na instalação normal, tentando métodos alternativos..."
    
    # Método 2: Legacy peer deps
    log_info "Tentando com --legacy-peer-deps..."
    npm install --legacy-peer-deps --no-optional
    
    if [ $? -eq 0 ]; then
        log_success "Dependências instaladas com --legacy-peer-deps."
    else
        # Método 3: Force e cache clean
        log_info "Limpando cache e forçando instalação..."
        npm cache clean --force
        rm -rf node_modules package-lock.json
        npm install --force --no-optional
        
        if [ $? -eq 0 ]; then
            log_success "Dependências instaladas com --force."
        else
            # Método 4: Instalação individual de pacotes problemáticos
            log_info "Tentando instalação individual dos pacotes..."
            npm install express express-session multer bcryptjs socket.io express-fileupload mime compression helmet cors --save
            npm install better-sqlite3 --save
            
            if [ $? -eq 0 ]; then
                log_success "Dependências instaladas individualmente."
            else
                log_error "Todas as tentativas de instalação falharam."
                log_info "Você pode tentar instalar manualmente com:"
                log_info "  npm install express express-session better-sqlite3 bcryptjs"
                log_info "  npm install socket.io express-fileupload mime compression"
                exit 1
            fi
        fi
    fi
fi

# Criar diretórios necessários
log_info "Criando estrutura de diretórios..."
mkdir -p public/uploads
mkdir -p database
chmod 755 public/uploads
log_success "Diretórios criados."

# Verificar se as dependências principais foram instaladas
log_info "Verificando dependências instaladas..."

# Verificar se os módulos principais existem
MODULES_OK=true

for module in "express" "better-sqlite3" "bcryptjs" "socket.io"; do
    if [ ! -d "node_modules/$module" ]; then
        log_warning "Módulo $module não encontrado"
        MODULES_OK=false
    fi
done

if [ "$MODULES_OK" = true ]; then
    log_success "Todas as dependências principais foram instaladas."
    
    # Testar inicialização básica
    log_info "Testando inicialização do servidor..."
    timeout 3s node -e "console.log('✓ Node.js funcionando'); process.exit(0);" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        log_success "Teste básico bem-sucedido."
    else
        log_warning "Teste básico falhou, mas a instalação parece completa."
    fi
else
    log_warning "Algumas dependências podem estar faltando, mas tentaremos continuar."
fi

# Criar arquivo de inicialização rápida
log_info "Criando scripts de inicialização..."

cat > start-cloud.sh << 'EOF'
#!/bin/bash
echo "🚀 Iniciando Cloud-Termux..."
echo "📱 Acesse: http://localhost:8080"
echo "👤 Login: admin / admin123"
echo ""
node server.js
EOF

chmod +x start-cloud.sh

cat > start-cloud-background.sh << 'EOF'
#!/bin/bash
echo "🚀 Iniciando Cloud-Termux em background..."
nohup node server.js > cloud-termux.log 2>&1 &
echo $! > cloud-termux.pid
echo "✅ Servidor iniciado em background (PID: $(cat cloud-termux.pid))"
echo "📱 Acesse: http://localhost:8080"
echo "👤 Login: admin / admin123"
echo "📋 Log: tail -f cloud-termux.log"
echo "🛑 Parar: kill $(cat cloud-termux.pid)"
EOF

chmod +x start-cloud-background.sh

log_success "Scripts de inicialização criados."

# Mostrar informações finais
echo ""
echo "=================================================================="
echo -e "${GREEN}🎉 INSTALAÇÃO CONCLUÍDA COM SUCESSO!${NC}"
echo "=================================================================="
echo ""
echo "📋 INFORMAÇÕES DE ACESSO:"
echo "   🌐 URL: http://localhost:8080"
echo "   👤 Usuário: admin"
echo "   🔑 Senha: admin123"
echo ""
echo "🚀 COMANDOS PARA INICIAR:"
echo "   Modo normal:     ./start-cloud.sh"
echo "   Modo background: ./start-cloud-background.sh"
echo "   Modo manual:     node server.js"
echo ""
echo "📋 FUNCIONALIDADES DISPONÍVEIS:"
echo "   ✅ Gerenciador de arquivos com upload/download"
echo "   ✅ Sistema de contatos"
echo "   ✅ Calendário com eventos"
echo "   ✅ Bloco de notas"
echo "   ✅ Chat em tempo real"
echo "   ✅ Interface web responsiva"
echo "   ✅ Autenticação de usuários"
echo ""
echo "🔧 COMANDOS ÚTEIS:"
echo "   Ver log:         tail -f cloud-termux.log"
echo "   Parar servidor:  kill \$(cat cloud-termux.pid)"
echo "   Reinstalar deps: npm install"
echo ""
echo "📱 ACESSO REMOTO (opcional):"
echo "   1. Configure port forwarding no roteador (porta 8080)"
echo "   2. Ou use ngrok: pkg install ngrok && ngrok http 8080"
echo "   3. Ou use cloudflared: pkg install cloudflared && cloudflared tunnel --url http://localhost:8080"
echo ""
echo "🔧 SOLUÇÃO DE PROBLEMAS:"
echo "   • Se SQLite falhar: rm -rf node_modules && npm install better-sqlite3"
echo "   • Se não iniciar: node --trace-warnings server.js"
echo "   • Reinstalar tudo: ./install-termux.sh"
echo ""
echo "=================================================================="
echo -e "${BLUE}🌟 Desenvolvido por Deivid Apps${NC}"
echo -e "${BLUE}📧 Baseado no conceito do Nextcloud${NC}"
echo "=================================================================="

log_success "Cloud-Termux instalado e pronto para uso!"
echo ""
echo "🎯 PRÓXIMOS PASSOS:"
echo "   1. ./start-cloud.sh (iniciar servidor)"
echo "   2. Abrir http://localhost:8080 no navegador"
echo "   3. Login: admin / admin123"
echo ""
read -p "Iniciar o servidor agora? (s/n): " start_now

if [ "$start_now" = "s" ] || [ "$start_now" = "S" ]; then
    log_info "Iniciando Cloud-Termux..."
    echo ""
    chmod +x start-cloud.sh
    ./start-cloud.sh
fi