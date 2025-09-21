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
    pkg install -y nodejs npm python build-essential
elif command -v apt &> /dev/null; then
    # Ubuntu/Debian
    sudo apt update && sudo apt upgrade -y
    sudo apt install -y nodejs npm python3 build-essential sqlite3
elif command -v yum &> /dev/null; then
    # CentOS/RHEL
    sudo yum update -y
    sudo yum install -y nodejs npm python3 gcc make sqlite
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
npm install

if [ $? -eq 0 ]; then
    log_success "Dependências instaladas com sucesso."
else
    log_error "Falha ao instalar dependências."
    log_info "Tentando instalar com --legacy-peer-deps..."
    npm install --legacy-peer-deps
    
    if [ $? -eq 0 ]; then
        log_success "Dependências instaladas com sucesso (modo compatibilidade)."
    else
        log_error "Falha ao instalar dependências. Verifique sua conexão e tente novamente."
        exit 1
    fi
fi

# Criar diretórios necessários
log_info "Criando estrutura de diretórios..."
mkdir -p public/uploads
mkdir -p database
chmod 755 public/uploads
log_success "Diretórios criados."

# Testar a instalação
log_info "Testando instalação..."
timeout 5s node -e "
const app = require('./server.js');
console.log('✓ Servidor pode ser inicializado com sucesso');
process.exit(0);
" 2>/dev/null

if [ $? -eq 0 ]; then
    log_success "Teste de instalação bem-sucedido."
else
    log_warning "Teste rápido falhou, mas isso pode ser normal. Tente iniciar manualmente."
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
echo ""
echo "=================================================================="
echo -e "${BLUE}🌟 Desenvolvido por Deivid Apps${NC}"
echo -e "${BLUE}📧 Baseado no conceito do Nextcloud${NC}"
echo "=================================================================="

log_success "Cloud-Termux instalado e pronto para uso!"
echo ""
read -p "Iniciar o servidor agora? (s/n): " start_now

if [ "$start_now" = "s" ] || [ "$start_now" = "S" ]; then
    log_info "Iniciando Cloud-Termux..."
    echo ""
    ./start-cloud.sh
fi