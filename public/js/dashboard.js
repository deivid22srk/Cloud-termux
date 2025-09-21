// Estado da aplicação
let currentUser = null;
let socket = null;
let files = [];
let contacts = [];
let events = [];
let notes = [];

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    initializeMobileMenu();
});

// Menu Mobile
function initializeMobileMenu() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    
    if (mobileMenuBtn && sidebar && sidebarOverlay) {
        mobileMenuBtn.addEventListener('click', function() {
            sidebar.classList.toggle('active');
            sidebarOverlay.classList.toggle('active');
        });
        
        sidebarOverlay.addEventListener('click', function() {
            sidebar.classList.remove('active');
            sidebarOverlay.classList.remove('active');
        });
        
        // Fechar menu ao clicar em link (mobile)
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', function() {
                if (window.innerWidth <= 768) {
                    sidebar.classList.remove('active');
                    sidebarOverlay.classList.remove('active');
                }
            });
        });
    }
}

async function initializeApp() {
    // Carregar informações do usuário
    try {
        const response = await fetch('/api/user');
        if (response.ok) {
            currentUser = await response.json();
            document.getElementById('userName').textContent = currentUser.username;
            document.getElementById('userAvatar').textContent = currentUser.username[0].toUpperCase();
        } else {
            window.location.href = '/login';
            return;
        }
    } catch (error) {
        console.error('Erro ao carregar usuário:', error);
        window.location.href = '/login';
        return;
    }

    // Inicializar Socket.IO
    initializeSocket();

    // Configurar navegação
    setupNavigation();

    // Configurar upload de arquivos
    setupFileUpload();

    // Configurar formulários
    setupForms();

    // Carregar dados iniciais
    await loadAllData();

    // Configurar chat input
    setupChatInput();

    // Gerar calendário
    generateCalendar();
}

function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Conectado ao servidor');
        socket.emit('join', currentUser);
    });

    socket.on('chat message', (data) => {
        addMessageToChat(data);
    });

    socket.on('disconnect', () => {
        console.log('Desconectado do servidor');
    });
}

function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const module = link.dataset.module;
            showModule(module);
            
            // Atualizar navegação ativa
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            // Fechar menu mobile se estiver aberto
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('active');
                document.getElementById('sidebarOverlay').classList.remove('active');
            }
        });
    });
}

function showModule(moduleName) {
    // Ocultar todos os módulos
    const modules = document.querySelectorAll('.module');
    modules.forEach(module => module.classList.remove('active'));
    
    // Mostrar módulo selecionado
    document.getElementById(moduleName).classList.add('active');
    
    // Atualizar título
    const titles = {
        dashboard: 'Dashboard',
        files: 'Gerenciador de Arquivos',
        contacts: 'Contatos',
        calendar: 'Calendário',
        notes: 'Notas',
        chat: 'Chat'
    };
    document.getElementById('currentModuleTitle').textContent = titles[moduleName];

    // Carregar dados específicos do módulo
    switch(moduleName) {
        case 'files':
            loadFiles();
            break;
        case 'contacts':
            loadContacts();
            break;
        case 'calendar':
            loadEvents();
            break;
        case 'notes':
            loadNotes();
            break;
        case 'chat':
            loadChatMessages();
            break;
    }
}

async function loadAllData() {
    await Promise.all([
        loadFiles(),
        loadContacts(),
        loadEvents(),
        loadNotes(),
        loadChatMessages()
    ]);
    updateDashboardStats();
}

function updateDashboardStats() {
    document.getElementById('filesCount').textContent = files.length;
    document.getElementById('contactsCount').textContent = contacts.length;
    document.getElementById('eventsCount').textContent = events.length;
    document.getElementById('notesCount').textContent = notes.length;
}

// === GERENCIAMENTO DE ARQUIVOS ===
function setupFileUpload() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');

    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });
}

function handleFiles(files) {
    Array.from(files).forEach(file => uploadFile(file));
}

async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const progressBar = document.getElementById('progressBar');
    const uploadStatus = document.getElementById('uploadStatus');
    const uploadProgress = document.getElementById('uploadProgress');

    uploadProgress.style.display = 'block';
    uploadStatus.textContent = `Enviando ${file.name}...`;

    try {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentage = (e.loaded / e.total) * 100;
                progressBar.style.width = percentage + '%';
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
                const response = JSON.parse(xhr.responseText);
                uploadStatus.textContent = `${file.name} enviado com sucesso!`;
                setTimeout(() => {
                    uploadProgress.style.display = 'none';
                    progressBar.style.width = '0%';
                }, 2000);
                loadFiles();
            } else {
                uploadStatus.textContent = 'Erro ao enviar arquivo.';
            }
        });

        xhr.addEventListener('error', () => {
            uploadStatus.textContent = 'Erro de conexão.';
        });

        xhr.open('POST', '/api/upload');
        xhr.send(formData);

    } catch (error) {
        console.error('Erro no upload:', error);
        uploadStatus.textContent = 'Erro ao enviar arquivo.';
    }
}

async function loadFiles() {
    try {
        const response = await fetch('/api/files');
        if (response.ok) {
            files = await response.json();
            displayFiles();
        }
    } catch (error) {
        console.error('Erro ao carregar arquivos:', error);
    }
}

function displayFiles() {
    const filesList = document.getElementById('filesList');
    
    if (files.length === 0) {
        filesList.innerHTML = '<p>Nenhum arquivo encontrado. Faça upload do primeiro arquivo!</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Nome</th>
                <th>Tamanho</th>
                <th>Data</th>
                <th>Ações</th>
            </tr>
        </thead>
        <tbody>
            ${files.map(file => `
                <tr>
                    <td>
                        <i class="fas fa-file"></i>
                        ${file.original_name}
                    </td>
                    <td>${formatFileSize(file.size)}</td>
                    <td>${new Date(file.created_at).toLocaleDateString()}</td>
                    <td>
                        <button class="btn btn-danger" onclick="deleteFile(${file.id})" style="padding: 6px 12px; font-size: 0.8rem;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    filesList.innerHTML = '';
    filesList.appendChild(table);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function deleteFile(fileId) {
    if (!confirm('Tem certeza que deseja excluir este arquivo?')) return;

    try {
        const response = await fetch(`/api/files/${fileId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            loadFiles();
            updateDashboardStats();
        } else {
            alert('Erro ao excluir arquivo');
        }
    } catch (error) {
        console.error('Erro ao excluir arquivo:', error);
        alert('Erro ao excluir arquivo');
    }
}

// === GERENCIAMENTO DE CONTATOS ===
async function loadContacts() {
    try {
        const response = await fetch('/api/contacts');
        if (response.ok) {
            contacts = await response.json();
            displayContacts();
        }
    } catch (error) {
        console.error('Erro ao carregar contatos:', error);
    }
}

function displayContacts() {
    const contactsList = document.getElementById('contactsList');
    
    if (contacts.length === 0) {
        contactsList.innerHTML = '<p>Nenhum contato encontrado. Adicione o primeiro contato!</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Nome</th>
                <th>Email</th>
                <th>Telefone</th>
                <th>Ações</th>
            </tr>
        </thead>
        <tbody>
            ${contacts.map(contact => `
                <tr>
                    <td>
                        <i class="fas fa-user"></i>
                        ${contact.name}
                    </td>
                    <td>${contact.email || '-'}</td>
                    <td>${contact.phone || '-'}</td>
                    <td>
                        <button class="btn btn-danger" onclick="deleteContact(${contact.id})" style="padding: 6px 12px; font-size: 0.8rem;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    contactsList.innerHTML = '';
    contactsList.appendChild(table);
}

async function deleteContact(contactId) {
    if (!confirm('Tem certeza que deseja excluir este contato?')) return;

    try {
        const response = await fetch(`/api/contacts/${contactId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            loadContacts();
            updateDashboardStats();
        } else {
            alert('Erro ao excluir contato');
        }
    } catch (error) {
        console.error('Erro ao excluir contato:', error);
        alert('Erro ao excluir contato');
    }
}

// === GERENCIAMENTO DE EVENTOS ===
async function loadEvents() {
    try {
        const response = await fetch('/api/calendar/events');
        if (response.ok) {
            events = await response.json();
            generateCalendar();
        }
    } catch (error) {
        console.error('Erro ao carregar eventos:', error);
    }
}

function generateCalendar() {
    const calendarGrid = document.getElementById('calendarGrid');
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // Limpar calendário
    calendarGrid.innerHTML = '';

    // Cabeçalhos dos dias da semana
    const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    weekDays.forEach(day => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'calendar-day header';
        dayHeader.textContent = day;
        calendarGrid.appendChild(dayHeader);
    });

    // Primeiro dia do mês e último dia do mês
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    // Gerar 42 dias (6 semanas)
    for (let i = 0; i < 42; i++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + i);

        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day';
        
        if (currentDate.getMonth() !== month) {
            dayElement.classList.add('other-month');
        }

        dayElement.innerHTML = `<div>${currentDate.getDate()}</div>`;

        // Verificar se há eventos neste dia
        const dayEvents = events.filter(event => {
            const eventDate = new Date(event.start_date);
            return eventDate.getDate() === currentDate.getDate() &&
                   eventDate.getMonth() === currentDate.getMonth() &&
                   eventDate.getFullYear() === currentDate.getFullYear();
        });

        if (dayEvents.length > 0) {
            const eventDot = document.createElement('div');
            eventDot.className = 'event-dot';
            dayElement.appendChild(eventDot);
        }

        calendarGrid.appendChild(dayElement);
    }
}

// === GERENCIAMENTO DE NOTAS ===
async function loadNotes() {
    try {
        const response = await fetch('/api/notes');
        if (response.ok) {
            notes = await response.json();
            displayNotes();
        }
    } catch (error) {
        console.error('Erro ao carregar notas:', error);
    }
}

function displayNotes() {
    const notesList = document.getElementById('notesList');
    
    if (notes.length === 0) {
        notesList.innerHTML = '<p>Nenhuma nota encontrada. Crie sua primeira nota!</p>';
        return;
    }

    notesList.innerHTML = notes.map(note => `
        <div class="note-card">
            <div class="note-title">${note.title}</div>
            <div class="note-content">${note.content || ''}</div>
            <div class="note-meta">
                <span>Criado em ${new Date(note.created_at).toLocaleDateString()}</span>
                ${note.tags ? `<br><strong>Tags:</strong> ${note.tags}` : ''}
            </div>
        </div>
    `).join('');
}

// === GERENCIAMENTO DE CHAT ===
async function loadChatMessages() {
    try {
        const response = await fetch('/api/chat/messages');
        if (response.ok) {
            const messages = await response.json();
            messages.forEach(message => addMessageToChat(message));
        }
    } catch (error) {
        console.error('Erro ao carregar mensagens:', error);
    }
}

function addMessageToChat(message) {
    const chatMessages = document.getElementById('chatMessages');
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    
    const messageTime = new Date(message.created_at).toLocaleTimeString();
    
    messageElement.innerHTML = `
        <div class="message-header">
            ${message.username}
            <span class="message-time">${messageTime}</span>
        </div>
        <div>${message.message}</div>
    `;
    
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setupChatInput() {
    const messageInput = document.getElementById('messageInput');
    
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (message && socket) {
        socket.emit('chat message', { message });
        messageInput.value = '';
    }
}

// === GERENCIAMENTO DE FORMULÁRIOS ===
function setupForms() {
    // Formulário de contato
    document.getElementById('contactForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const contactData = {
            name: document.getElementById('contactName').value,
            email: document.getElementById('contactEmail').value,
            phone: document.getElementById('contactPhone').value,
            notes: document.getElementById('contactNotes').value
        };

        try {
            const response = await fetch('/api/contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(contactData)
            });

            if (response.ok) {
                hideModal('contactModal');
                document.getElementById('contactForm').reset();
                loadContacts();
                updateDashboardStats();
            } else {
                alert('Erro ao salvar contato');
            }
        } catch (error) {
            console.error('Erro ao salvar contato:', error);
            alert('Erro ao salvar contato');
        }
    });

    // Formulário de evento
    document.getElementById('eventForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const eventData = {
            title: document.getElementById('eventTitle').value,
            description: document.getElementById('eventDescription').value,
            start_date: document.getElementById('eventStartDate').value,
            end_date: document.getElementById('eventEndDate').value,
            all_day: document.getElementById('eventAllDay').checked
        };

        try {
            const response = await fetch('/api/calendar/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(eventData)
            });

            if (response.ok) {
                hideModal('eventModal');
                document.getElementById('eventForm').reset();
                loadEvents();
                updateDashboardStats();
            } else {
                alert('Erro ao salvar evento');
            }
        } catch (error) {
            console.error('Erro ao salvar evento:', error);
            alert('Erro ao salvar evento');
        }
    });

    // Formulário de nota
    document.getElementById('noteForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const noteData = {
            title: document.getElementById('noteTitle').value,
            content: document.getElementById('noteContent').value,
            tags: document.getElementById('noteTags').value
        };

        try {
            const response = await fetch('/api/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(noteData)
            });

            if (response.ok) {
                hideModal('noteModal');
                document.getElementById('noteForm').reset();
                loadNotes();
                updateDashboardStats();
            } else {
                alert('Erro ao salvar nota');
            }
        } catch (error) {
            console.error('Erro ao salvar nota:', error);
            alert('Erro ao salvar nota');
        }
    });
}

// === GERENCIAMENTO DE MODALS ===
function showModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Fechar modal clicando fora
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});

// === LOGOUT ===
async function logout() {
    try {
        const response = await fetch('/logout', {
            method: 'POST'
        });

        if (response.ok) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Erro ao fazer logout:', error);
        window.location.href = '/login';
    }
}