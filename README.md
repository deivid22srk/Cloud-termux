# 🚀 Cloud-Termux

Uma plataforma de colaboração e armazenamento em nuvem **self-hosted** inspirada no **Nextcloud**, otimizada para rodar no **Termux** e outros sistemas Linux.

![Cloud-Termux](https://img.shields.io/badge/Cloud-Termux-blue?style=for-the-badge&logo=android)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

## 📱 Sobre o Projeto

O **Cloud-Termux** é uma solução completa de nuvem pessoal que permite você ter controle total sobre seus dados. Inspirado nas funcionalidades do Nextcloud, oferece uma interface web moderna e responsiva para gerenciar arquivos, contatos, calendário, notas e chat em tempo real.

### 🌟 Por que usar?

- **📱 Interface Mobile-First**: Design totalmente responsivo e otimizado para celulares
- **⚡ Sistema Adaptativo**: Detecta automaticamente qual banco usar (SQLite → JSON)
- **🔐 Zero Compilação**: Modo JSON que funciona em qualquer sistema
- **🔧 Auto-Correção**: Scripts inteligentes que resolvem problemas automaticamente

## ✨ Funcionalidades

### 📁 **Gerenciador de Arquivos**
- ⬆️ Upload de arquivos (até 50MB)
- 📱 Interface drag & drop
- 📊 Visualização de tamanhos e datas
- 🗑️ Exclusão segura de arquivos

### 📞 **Sistema de Contatos**
- 👥 Adicionar e gerenciar contatos
- 📧 Armazenar emails e telefones
- 📝 Adicionar notas aos contatos
- 🔍 Interface organizada

### 📅 **Calendário Integrado**
- 📆 Visualização mensal
- ➕ Criar eventos e compromissos
- ⏰ Eventos de dia inteiro
- 🎯 Indicadores visuais de eventos

### 📝 **Sistema de Notas**
- ✍️ Criar e organizar notas
- 🏷️ Sistema de tags
- 📄 Interface estilo cards
- ⏰ Controle de data de criação

### 💬 **Chat em Tempo Real**
- 🚀 Mensagens instantâneas
- 👥 Chat multiplataforma
- 📱 Interface responsiva
- 🔄 Sincronização automática

### 🔐 **Sistema de Autenticação**
- 🔒 Login seguro
- 👤 Sessões persistentes
- 🛡️ Proteção de rotas
- 📊 Gerenciamento de usuários

## 🚀 Instalação

### Pré-requisitos
- **Termux** (recomendado) ou qualquer sistema Linux
- **Node.js** 14+ 
- **NPM**
- Conexão com internet para instalação inicial

### 🔧 Instalação Automática (Recomendada)

```bash
# Clone o repositório
git clone https://github.com/deivid22srk/Cloud-termux.git
cd Cloud-termux

# Execute o script de instalação
chmod +x install-termux.sh
./install-termux.sh
```

**🚪PROBLEMAS DE INSTALAÇÃO?** 🚑 **USE NOSSO SISTEMA DE AUTO-CORREÇÃO:**
```bash
# Método 1: Script de correção automática
./fix-cloud-termux.sh

# Método 2: Modo super-seguro (100% compatível)
cp package-safe.json package.json
npm install --no-optional --production
node server-adaptive.js
```

### 🛠️ Instalação Manual

```bash
# Clone o repositório
git clone https://github.com/deivid22srk/Cloud-termux.git
cd Cloud-termux

# Instale as dependências
npm install

# Crie as pastas necessárias
mkdir -p public/uploads database

# Inicie o servidor
node server.js
```

## 🏃‍♂️ Como Usar

### Iniciar o Servidor

```bash
# Método 1: Usando script (modo normal)
./start-cloud.sh

# Método 2: Usando script (background)
./start-cloud-background.sh

# Método 3: Comando direto
node server.js
```

### 🌐 Acessar a Interface

1. Abra seu navegador
2. Acesse: `http://localhost:8080`
3. Faça login com:
   - **Usuário**: `admin`
   - **Senha**: `admin123`

### 📱 Acesso Remoto

#### Opção 1: Port Forwarding
Configure seu roteador para redirecionar a porta 8080 para seu dispositivo.

#### Opção 2: Ngrok (Mais Fácil)
```bash
# Instalar ngrok no Termux
pkg install ngrok

# Criar túnel público
ngrok http 8080
```

## 📋 Comandos Úteis

```bash
# Ver logs em tempo real
tail -f cloud-termux.log

# Parar servidor em background
kill $(cat cloud-termux.pid)

# Reinstalar dependências
npm install

# Verificar status do processo
ps aux | grep node

# Limpar logs
> cloud-termux.log
```

## 🏗️ Estrutura do Projeto

```
Cloud-termux/
├── 📁 public/              # Arquivos estáticos
│   ├── 📁 css/            # Estilos (embutidos no HTML)
│   ├── 📁 js/             # Scripts JavaScript
│   ├── 📁 uploads/        # Arquivos enviados pelos usuários
│   ├── login.html         # Página de login
│   └── dashboard.html     # Interface principal
├── 📁 database/           # Banco de dados SQLite
├── server.js              # Servidor principal
├── package.json           # Dependências do Node.js
├── install-termux.sh      # Script de instalação
├── start-cloud.sh         # Script de inicialização
└── README.md              # Este arquivo
```

## 🔧 Configurações

### Alterar Porta
Edite o arquivo `server.js` ou use variável de ambiente:
```bash
PORT=3000 node server.js
```

### Configurar Limites de Upload
No arquivo `server.js`, linha 28:
```javascript
limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
```

### Adicionar Usuários
Execute consultas no banco SQLite em `database/cloud.db`:
```sql
INSERT INTO users (username, password, email) 
VALUES ('novouser', 'senha_hash_bcrypt', 'email@exemplo.com');
```

## 🛡️ Segurança

### Funcionalidades de Segurança Implementadas:
- ✅ Hashing de senhas com bcryptjs
- ✅ Sessões seguras
- ✅ Proteção contra XSS básica
- ✅ Validação de uploads
- ✅ Limitação de tamanho de arquivos
- ✅ Headers de segurança com Helmet
- ✅ Better-SQLite3 (mais seguro que sqlite3 legacy)
- ✅ Dependências atualizadas (sem vulnerabilidades conhecidas)

### Recomendações Adicionais:
- 🔒 Altere a senha padrão do admin
- 🌐 Use HTTPS em produção
- 🔥 Configure firewall se necessário
- 📱 Use autenticação de dois fatores (implementação futura)

## 🐛 Solução de Problemas

### ❌ **"ModuleNotFoundError: No module named 'distutils'"**
⚠️ **PROBLEMA COMUM NO PYTHON 3.12**

**Solução:**
```bash
# Método 1: Script automático
./fix-cloud-termux.sh

# Método 2: Manual
pkg install python-pip
pip install setuptools wheel distutils-extra
```

### ❌ **"SQLite3 compilation failed"**
⚠️ **RESOLVIDO:** Agora usamos `better-sqlite3` que não requer compilação

**Se ainda der problema:**
```bash
rm -rf node_modules/sqlite3
npm install better-sqlite3 --save
```

### ❌ **"npm not found"**
```bash
# No Termux
pkg install nodejs
# O npm geralmente vem junto

# Se não funcionar
ln -sf $PREFIX/lib/node_modules/npm/bin/npm-cli.js $PREFIX/bin/npm
```

### ❌ **"Erro ao conectar com servidor"**
- Verifique se o servidor está rodando: `ps aux | grep node`
- Tente reiniciar: `./start-cloud.sh`
- Verifique logs: `tail -f cloud-termux.log`

### ❌ **"Porta já em uso"**
- Altere a porta no `server.js` ou mate o processo:
```bash
lsof -ti:8080 | xargs kill
```

### ❌ **"Falha ao instalar dependências"**
**Solução escalonada:**
```bash
# 1. Tente o script de correção
./fix-cloud-termux.sh

# 2. Limpe tudo e reinstale
rm -rf node_modules package-lock.json
npm cache clean --force
npm install --no-optional

# 3. Instalação individual
npm install express better-sqlite3 bcryptjs socket.io
```

### ❌ **"Banco de dados corrompido"**
- Exclua o arquivo: `rm database/cloud.db`
- Reinicie o servidor para recriar automaticamente

### 🚪 **INSTALAÇÃO LIMPA (Reset Completo)**
```bash
# Remover tudo e começar do zero
cd Cloud-termux
rm -rf node_modules package-lock.json database
rm -f cloud-termux.log cloud-termux.pid

# Reinstalar
./fix-cloud-termux.sh
```

## 🤝 Contribuição

Contribuições são bem-vindas! Para contribuir:

1. 🍴 Fork o projeto
2. 🌿 Crie uma branch para sua feature (`git checkout -b feature/MinhaFeature`)
3. 💾 Commit suas mudanças (`git commit -m 'Adiciona MinhaFeature'`)
4. 📤 Push para a branch (`git push origin feature/MinhaFeature`)
5. 🔀 Abra um Pull Request

### 📋 TODO List (Próximas Funcionalidades)
- [ ] 🔐 Autenticação de dois fatores
- [ ] 🌙 Modo escuro
- [ ] 📊 Dashboard com gráficos
- [ ] 🔄 Sincronização com outros dispositivos
- [ ] 📱 App móvel nativo (PWA)
- [ ] 🎨 Temas customizáveis
- [ ] 📧 Sistema de notificações
- [ ] 🗂️ Pastas para organização de arquivos
- [ ] 👥 Múltiplos usuários com permissões
- [ ] 🔍 Busca global
- [x] ✅ **Migração para better-sqlite3**
- [x] ✅ **Correção de compatibilidade Python 3.12**
- [x] ✅ **Script de correção automática**

## 📄 Licença

Este projeto está licenciado sob a MIT License - veja o arquivo [LICENSE](LICENSE) para detalhes.

## 👨‍💻 Autor

**Deivid Apps**
- 📧 Email: [seu-email@exemplo.com]
- 🐙 GitHub: [@deivid22srk](https://github.com/deivid22srk)

## 🙏 Agradecimentos

- 🌟 **Nextcloud** - Inspiração para as funcionalidades
- 📱 **Termux** - Plataforma incrível para desenvolvimento mobile
- 🚀 **Node.js Community** - Ferramentas e bibliotecas utilizadas
- 💻 **Express.js** - Framework web robusto
- 🗄️ **SQLite** - Banco de dados leve e eficiente

---

<div align="center">

### 🌟 Se este projeto te ajudou, deixe uma ⭐!

### 📱 Transforme seu celular em um servidor de nuvem pessoal!

</div>

---

**Versão:** 1.0.0  
**Última Atualização:** Janeiro 2025