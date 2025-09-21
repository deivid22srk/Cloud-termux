const express = require('express');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIO = require('socket.io');
const mime = require('mime');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const { execSync } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 8080;

// Configurações de armazenamento
let STORAGE_CONFIG = {
  uploadsPath: path.join(__dirname, 'public', 'uploads'),
  externalStorage: false,
  externalPath: ''
};

// Carregar configurações de armazenamento
function loadStorageConfig() {
  const configPath = path.join(__dirname, 'storage-config.json');
  if (fs.existsSync(configPath)) {
    try {
      STORAGE_CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('📁 Configurações de armazenamento carregadas:', STORAGE_CONFIG.externalStorage ? STORAGE_CONFIG.externalPath : 'Padrão');
    } catch (error) {
      console.error('❌ Erro ao carregar configurações de armazenamento:', error.message);
    }
  }
}

// Salvar configurações de armazenamento
function saveStorageConfig() {
  const configPath = path.join(__dirname, 'storage-config.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify(STORAGE_CONFIG, null, 2));
    console.log('✅ Configurações de armazenamento salvas');
  } catch (error) {
    console.error('❌ Erro ao salvar configurações:', error.message);
  }
}

// Obter informações de espaço livre
function getStorageInfo(storagePath) {
  try {
    let command;
    if (process.platform === 'win32') {
      // Windows
      command = `dir /-c "${storagePath}"`;
    } else {
      // Linux/Termux
      command = `df -h "${storagePath}"`;
    }
    
    const output = execSync(command, { encoding: 'utf8' });
    
    if (process.platform === 'win32') {
      // Parse Windows dir output
      const lines = output.split('\n');
      const lastLine = lines[lines.length - 2] || '';
      const match = lastLine.match(/([0-9,]+)\s+bytes\s+free/);
      if (match) {
        const freeBytes = parseInt(match[1].replace(/,/g, ''));
        return {
          free: formatFileSize(freeBytes),
          freeBytes: freeBytes,
          total: 'N/A',
          used: 'N/A'
        };
      }
    } else {
      // Parse Linux df output
      const lines = output.split('\n');
      const dataLine = lines[1] || '';
      const parts = dataLine.split(/\s+/);
      if (parts.length >= 4) {
        return {
          total: parts[1],
          used: parts[2], 
          free: parts[3],
          percentage: parts[4],
          freeBytes: parseInt(parts[3]) * 1024 // Convert KB to bytes
        };
      }
    }
  } catch (error) {
    console.error('❌ Erro ao obter informações de storage:', error.message);
  }
  
  return {
    free: 'N/A',
    total: 'N/A',
    used: 'N/A',
    percentage: 'N/A',
    freeBytes: 0
  };
}

// Sistema de banco adaptativo - detecta automaticamente qual usar
let DB_TYPE = 'json'; // fallback padrão
let db = null;

// Detectar e configurar sistema de banco de dados
function initDatabaseSystem() {
  console.log('🔍 Detectando sistema de banco de dados disponível...');
  
  // Carregar configurações de armazenamento
  loadStorageConfig();
  
  // Criar diretórios necessários
  const dirs = ['database', 'temp'];
  dirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`📁 Diretório criado: ${dir}`);
    }
  });
  
  // Criar diretório de uploads (padrão ou externo)
  const uploadsPath = STORAGE_CONFIG.externalStorage ? STORAGE_CONFIG.externalPath : STORAGE_CONFIG.uploadsPath;
  if (!fs.existsSync(uploadsPath)) {
    try {
      fs.mkdirSync(uploadsPath, { recursive: true });
      console.log(`📁 Diretório de uploads criado: ${uploadsPath}`);
    } catch (error) {
      console.error(`❌ Erro ao criar diretório de uploads: ${error.message}`);
      // Fallback para diretório padrão
      STORAGE_CONFIG.externalStorage = false;
      if (!fs.existsSync(STORAGE_CONFIG.uploadsPath)) {
        fs.mkdirSync(STORAGE_CONFIG.uploadsPath, { recursive: true });
      }
    }
  }
  
  // Tentar better-sqlite3 primeiro
  try {
    const Database = require('better-sqlite3');
    const DB_PATH = path.join(__dirname, 'database', 'cloud.db');
    
    if (!fs.existsSync(path.dirname(DB_PATH))) {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    }
    
    db = new Database(DB_PATH);
    DB_TYPE = 'better-sqlite3';
    console.log('✅ Usando better-sqlite3');
    return true;
  } catch (error) {
    console.log('⚠️ better-sqlite3 não disponível:', error.message);
  }
  
  // Tentar sql.js
  try {
    const initSqlJs = require('sql.js');
    DB_TYPE = 'sqljs';
    console.log('✅ Usando sql.js (em memória)');
    return true;
  } catch (error) {
    console.log('⚠️ sql.js não disponível:', error.message);
  }
  
  // Usar JSON como fallback
  console.log('📁 Usando armazenamento JSON como fallback');
  console.log('✅ Modo totalmente compatível - sem dependências de compilação');
  DB_TYPE = 'json';
  return true;
}

// Classe para gerenciar dados independente do banco
class DataManager {
  constructor() {
    this.jsonPath = path.join(__dirname, 'database', 'data.json');
    this.data = {
      users: [],
      files: [],
      contacts: [],
      calendar_events: [],
      notes: [],
      chat_messages: []
    };
    
    if (DB_TYPE === 'json') {
      this.loadJsonData();
    } else {
      this.initSqlTables();
    }
  }
  
  loadJsonData() {
    try {
      if (fs.existsSync(this.jsonPath)) {
        this.data = JSON.parse(fs.readFileSync(this.jsonPath, 'utf8'));
      } else {
        this.saveJsonData();
      }
      
      // Adicionar usuário admin se não existir
      if (this.data.users.length === 0) {
        const adminPassword = bcrypt.hashSync('admin123', 10);
        this.data.users.push({
          id: 1,
          username: 'admin',
          password: adminPassword,
          email: 'admin@cloud-termux.local',
          created_at: new Date().toISOString()
        });
        this.saveJsonData();
      }
      
      console.log('✅ Dados JSON carregados');
    } catch (error) {
      console.error('Erro ao carregar dados JSON:', error);
      this.saveJsonData();
    }
  }
  
  saveJsonData() {
    try {
      if (!fs.existsSync(path.dirname(this.jsonPath))) {
        fs.mkdirSync(path.dirname(this.jsonPath), { recursive: true });
      }
      fs.writeFileSync(this.jsonPath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Erro ao salvar dados JSON:', error);
    }
  }
  
  initSqlTables() {
    if (DB_TYPE === 'better-sqlite3') {
      try {
        // Criar tabelas
        db.exec(`CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          email TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.exec(`CREATE TABLE IF NOT EXISTS files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          filename TEXT NOT NULL,
          original_name TEXT NOT NULL,
          size INTEGER NOT NULL,
          mimetype TEXT,
          path TEXT NOT NULL,
          folder TEXT DEFAULT '',
          shared BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id)
        )`);
        
        db.exec(`CREATE TABLE IF NOT EXISTS contacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id)
        )`);
        
        db.exec(`CREATE TABLE IF NOT EXISTS calendar_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          title TEXT NOT NULL,
          description TEXT,
          start_date DATETIME NOT NULL,
          end_date DATETIME,
          all_day BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id)
        )`);
        
        db.exec(`CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          title TEXT NOT NULL,
          content TEXT,
          tags TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id)
        )`);
        
        db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          username TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id)
        )`);
        
        // Criar usuário admin padrão
        const adminPassword = bcrypt.hashSync('admin123', 10);
        const insertAdmin = db.prepare(`INSERT OR IGNORE INTO users (username, password, email) VALUES (?, ?, ?)`);
        insertAdmin.run('admin', adminPassword, 'admin@cloud-termux.local');
        
        console.log('✅ Tabelas SQL criadas');
      } catch (error) {
        console.error('Erro ao criar tabelas:', error);
      }
    }
  }
  
  // Métodos universais que funcionam com qualquer tipo de banco
  getUser(username) {
    if (DB_TYPE === 'json') {
      return this.data.users.find(u => u.username === username);
    } else if (DB_TYPE === 'better-sqlite3') {
      return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    }
    return null;
  }
  
  getFiles(userId, folder = '') {
    if (DB_TYPE === 'json') {
      return this.data.files
        .filter(f => f.user_id === userId && (f.folder || '') === folder)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (DB_TYPE === 'better-sqlite3') {
      return db.prepare('SELECT * FROM files WHERE user_id = ? AND folder = ? ORDER BY created_at DESC').all(userId, folder);
    }
    return [];
  }
  
  createFolder(userId, folderName, parentFolder = '') {
    const folderData = {
      user_id: userId,
      filename: folderName,
      original_name: folderName,
      size: 0,
      mimetype: 'folder',
      path: '',
      folder: parentFolder,
      shared: 0,
      created_at: new Date().toISOString()
    };
    
    if (DB_TYPE === 'json') {
      folderData.id = this.data.files.length > 0 ? Math.max(...this.data.files.map(f => f.id)) + 1 : 1;
      this.data.files.push(folderData);
      this.saveJsonData();
      return { lastInsertRowid: folderData.id };
    } else if (DB_TYPE === 'better-sqlite3') {
      const insert = db.prepare(`INSERT INTO files (user_id, filename, original_name, size, mimetype, path, folder) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      return insert.run(userId, folderName, folderName, 0, 'folder', '', parentFolder);
    }
  }
  
  getFolders(userId, parentFolder = '') {
    if (DB_TYPE === 'json') {
      return this.data.files
        .filter(f => f.user_id === userId && f.mimetype === 'folder' && (f.folder || '') === parentFolder)
        .sort((a, b) => a.original_name.localeCompare(b.original_name));
    } else if (DB_TYPE === 'better-sqlite3') {
      return db.prepare('SELECT * FROM files WHERE user_id = ? AND mimetype = ? AND folder = ? ORDER BY original_name').all(userId, 'folder', parentFolder);
    }
    return [];
  }
  
  addFile(userId, fileName, originalName, size, mimetype, filePath, folder = '') {
    const fileData = {
      user_id: userId,
      filename: fileName,
      original_name: originalName,
      size: size,
      mimetype: mimetype,
      path: filePath,
      folder: folder,
      shared: 0,
      created_at: new Date().toISOString()
    };
    
    if (DB_TYPE === 'json') {
      fileData.id = this.data.files.length > 0 ? Math.max(...this.data.files.map(f => f.id)) + 1 : 1;
      this.data.files.push(fileData);
      this.saveJsonData();
      return { lastInsertRowid: fileData.id };
    } else if (DB_TYPE === 'better-sqlite3') {
      const insert = db.prepare(`INSERT INTO files (user_id, filename, original_name, size, mimetype, path) VALUES (?, ?, ?, ?, ?, ?)`);
      return insert.run(userId, fileName, originalName, size, mimetype, filePath);
    }
  }
  
  deleteFile(fileId, userId) {
    if (DB_TYPE === 'json') {
      const fileIndex = this.data.files.findIndex(f => f.id == fileId && f.user_id == userId);
      if (fileIndex !== -1) {
        const file = this.data.files[fileIndex];
        this.data.files.splice(fileIndex, 1);
        this.saveJsonData();
        return file;
      }
      return null;
    } else if (DB_TYPE === 'better-sqlite3') {
      const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(fileId, userId);
      if (file) {
        db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
      }
      return file;
    }
  }
  
  getContacts(userId) {
    if (DB_TYPE === 'json') {
      return this.data.contacts.filter(c => c.user_id === userId).sort((a, b) => a.name.localeCompare(b.name));
    } else if (DB_TYPE === 'better-sqlite3') {
      return db.prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY name').all(userId);
    }
    return [];
  }
  
  addContact(userId, name, email, phone, notes) {
    const contactData = {
      user_id: userId,
      name: name,
      email: email,
      phone: phone,
      notes: notes,
      created_at: new Date().toISOString()
    };
    
    if (DB_TYPE === 'json') {
      contactData.id = this.data.contacts.length > 0 ? Math.max(...this.data.contacts.map(c => c.id)) + 1 : 1;
      this.data.contacts.push(contactData);
      this.saveJsonData();
      return { lastInsertRowid: contactData.id };
    } else if (DB_TYPE === 'better-sqlite3') {
      const insert = db.prepare('INSERT INTO contacts (user_id, name, email, phone, notes) VALUES (?, ?, ?, ?, ?)');
      return insert.run(userId, name, email, phone, notes);
    }
  }
  
  deleteContact(contactId, userId) {
    if (DB_TYPE === 'json') {
      const contactIndex = this.data.contacts.findIndex(c => c.id == contactId && c.user_id == userId);
      if (contactIndex !== -1) {
        this.data.contacts.splice(contactIndex, 1);
        this.saveJsonData();
        return true;
      }
      return false;
    } else if (DB_TYPE === 'better-sqlite3') {
      const result = db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(contactId, userId);
      return result.changes > 0;
    }
  }
  
  getEvents(userId) {
    if (DB_TYPE === 'json') {
      return this.data.calendar_events.filter(e => e.user_id === userId).sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    } else if (DB_TYPE === 'better-sqlite3') {
      return db.prepare('SELECT * FROM calendar_events WHERE user_id = ? ORDER BY start_date').all(userId);
    }
    return [];
  }
  
  addEvent(userId, title, description, startDate, endDate, allDay) {
    const eventData = {
      user_id: userId,
      title: title,
      description: description,
      start_date: startDate,
      end_date: endDate,
      all_day: allDay ? 1 : 0,
      created_at: new Date().toISOString()
    };
    
    if (DB_TYPE === 'json') {
      eventData.id = this.data.calendar_events.length > 0 ? Math.max(...this.data.calendar_events.map(e => e.id)) + 1 : 1;
      this.data.calendar_events.push(eventData);
      this.saveJsonData();
      return { lastInsertRowid: eventData.id };
    } else if (DB_TYPE === 'better-sqlite3') {
      const insert = db.prepare(`INSERT INTO calendar_events (user_id, title, description, start_date, end_date, all_day) VALUES (?, ?, ?, ?, ?, ?)`);
      return insert.run(userId, title, description, startDate, endDate, allDay ? 1 : 0);
    }
  }
  
  getNotes(userId) {
    if (DB_TYPE === 'json') {
      return this.data.notes.filter(n => n.user_id === userId).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    } else if (DB_TYPE === 'better-sqlite3') {
      return db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
    }
    return [];
  }
  
  addNote(userId, title, content, tags) {
    const noteData = {
      user_id: userId,
      title: title,
      content: content,
      tags: tags,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    if (DB_TYPE === 'json') {
      noteData.id = this.data.notes.length > 0 ? Math.max(...this.data.notes.map(n => n.id)) + 1 : 1;
      this.data.notes.push(noteData);
      this.saveJsonData();
      return { lastInsertRowid: noteData.id };
    } else if (DB_TYPE === 'better-sqlite3') {
      const insert = db.prepare('INSERT INTO notes (user_id, title, content, tags) VALUES (?, ?, ?, ?)');
      return insert.run(userId, title, content, tags);
    }
  }
  
  getChatMessages(limit = 50) {
    if (DB_TYPE === 'json') {
      return this.data.chat_messages.slice(-limit);
    } else if (DB_TYPE === 'better-sqlite3') {
      return db.prepare('SELECT * FROM chat_messages ORDER BY created_at ASC LIMIT ?').all(limit);
    }
    return [];
  }
  
  addChatMessage(userId, username, message) {
    const messageData = {
      user_id: userId,
      username: username,
      message: message,
      created_at: new Date().toISOString()
    };
    
    if (DB_TYPE === 'json') {
      messageData.id = this.data.chat_messages.length > 0 ? Math.max(...this.data.chat_messages.map(m => m.id)) + 1 : 1;
      this.data.chat_messages.push(messageData);
      // Manter apenas últimas 1000 mensagens
      if (this.data.chat_messages.length > 1000) {
        this.data.chat_messages = this.data.chat_messages.slice(-1000);
      }
      this.saveJsonData();
      return true;
    } else if (DB_TYPE === 'better-sqlite3') {
      const insert = db.prepare('INSERT INTO chat_messages (user_id, username, message) VALUES (?, ?, ?)');
      const result = insert.run(userId, username, message);
      return result.changes > 0;
    }
  }
}

// Inicializar sistema
initDatabaseSystem();
const dataManager = new DataManager();

// Middleware de segurança
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(compression());
app.use(cors());

// Configuração do Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(fileUpload({
  createParentPath: true,
  limits: { fileSize: 50 * 1024 * 1024 },
  useTempFiles: true,
  tempFileDir: path.join(__dirname, 'temp'), // Usar pasta local ao invés de /tmp/
  debug: false
}));

// Sessões
app.use(session({
  secret: 'cloud-termux-secret-' + Math.random().toString(36),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Middleware de autenticação
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  } else {
    return res.redirect('/login');
  }
}

// ROTAS DE AUTENTICAÇÃO
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  try {
    const user = dataManager.getUser(username);
    
    if (user && bcrypt.compareSync(password, user.password)) {
      req.session.user = {
        id: user.id,
        username: user.username,
        email: user.email
      };
      res.json({ success: true, redirect: '/dashboard' });
    } else {
      res.status(401).json({ error: 'Credenciais inválidas' });
    }
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro no sistema' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, redirect: '/login' });
});

// ROTAS PRINCIPAIS
app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/user', requireAuth, (req, res) => {
  res.json(req.session.user);
});

// ROTAS DE ARQUIVOS
app.post('/api/upload', requireAuth, (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }
  
  const file = req.files.file;
  const folder = req.body.folder || '';
  const fileName = Date.now() + '-' + file.name;
  
  // Usar pasta configurada (externa ou padrão)
  const baseUploadPath = STORAGE_CONFIG.externalStorage ? STORAGE_CONFIG.externalPath : STORAGE_CONFIG.uploadsPath;
  const folderPath = folder ? path.join(baseUploadPath, folder) : baseUploadPath;
  const uploadPath = path.join(folderPath, fileName);
  
  // Criar pasta se não existir
  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao criar pasta de destino: ' + error.message });
  }
  
  file.mv(uploadPath, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao salvar arquivo: ' + err.message });
    }
    
    try {
      const result = dataManager.addFile(req.session.user.id, fileName, file.name, file.size, file.mimetype, uploadPath, folder);
      res.json({ success: true, fileId: result.lastInsertRowid, fileName: file.name });
    } catch (error) {
      console.error('Erro ao salvar arquivo:', error);
      res.status(500).json({ error: 'Erro ao salvar informações do arquivo' });
    }
  });
});

app.get('/api/files', requireAuth, (req, res) => {
  const folder = req.query.folder || '';
  try {
    const files = dataManager.getFiles(req.session.user.id, folder);
    const folders = dataManager.getFolders(req.session.user.id, folder);
    res.json({ files, folders });
  } catch (error) {
    console.error('Erro ao buscar arquivos:', error);
    res.status(500).json({ error: 'Erro ao buscar arquivos' });
  }
});

app.delete('/api/files/:id', requireAuth, (req, res) => {
  const fileId = req.params.id;
  
  try {
    const file = dataManager.deleteFile(fileId, req.session.user.id);
    
    if (!file) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    
    // Deletar arquivo físico (se não for pasta)
    if (file.mimetype !== 'folder' && file.path) {
      fs.unlink(file.path, (unlinkErr) => {
        if (unlinkErr) console.log('Arquivo físico já removido ou não encontrado');
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar arquivo:', error);
    res.status(500).json({ error: 'Erro ao deletar arquivo' });
  }
});

// ROTA PARA DOWNLOAD DE ARQUIVOS
app.get('/api/download/:id', requireAuth, (req, res) => {
  const fileId = req.params.id;
  
  try {
    let file;
    if (DB_TYPE === 'json') {
      file = dataManager.data.files.find(f => f.id == fileId && f.user_id == req.session.user.id);
    } else if (DB_TYPE === 'better-sqlite3') {
      file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(fileId, req.session.user.id);
    }
    
    if (!file || file.mimetype === 'folder') {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    
    if (!fs.existsSync(file.path)) {
      return res.status(404).json({ error: 'Arquivo não encontrado no disco' });
    }
    
    // Configurar headers para download
    res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
    res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
    
    // Enviar arquivo
    const fileStream = fs.createReadStream(file.path);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('Erro ao fazer download:', error);
    res.status(500).json({ error: 'Erro ao fazer download do arquivo' });
  }
});

// ROTA PARA CRIAR PASTAS
app.post('/api/folders', requireAuth, (req, res) => {
  const { name, parentFolder } = req.body;
  
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Nome da pasta é obrigatório' });
  }
  
  try {
    const result = dataManager.createFolder(req.session.user.id, name.trim(), parentFolder || '');
    res.json({ success: true, folderId: result.lastInsertRowid });
  } catch (error) {
    console.error('Erro ao criar pasta:', error);
    res.status(500).json({ error: 'Erro ao criar pasta' });
  }
});

// ROTA PARA INFORMAÇÕES DE STORAGE
app.get('/api/storage/info', requireAuth, (req, res) => {
  try {
    const storagePath = STORAGE_CONFIG.externalStorage ? STORAGE_CONFIG.externalPath : STORAGE_CONFIG.uploadsPath;
    const storageInfo = getStorageInfo(storagePath);
    
    res.json({
      ...storageInfo,
      path: storagePath,
      external: STORAGE_CONFIG.externalStorage
    });
  } catch (error) {
    console.error('Erro ao obter informações de storage:', error);
    res.status(500).json({ error: 'Erro ao obter informações de storage' });
  }
});

// ROTA PARA CONFIGURAÇÕES DE STORAGE
app.get('/api/storage/config', requireAuth, (req, res) => {
  res.json(STORAGE_CONFIG);
});

app.post('/api/storage/config', requireAuth, (req, res) => {
  const { externalStorage, externalPath } = req.body;
  
  try {
    if (externalStorage && externalPath) {
      // Verificar se o caminho existe e é acessível
      if (!fs.existsSync(externalPath)) {
        try {
          fs.mkdirSync(externalPath, { recursive: true });
        } catch (error) {
          return res.status(400).json({ error: 'Não foi possível acessar ou criar o diretório especificado' });
        }
      }
      
      // Testar escrita
      const testFile = path.join(externalPath, '.test-write');
      try {
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
      } catch (error) {
        return res.status(400).json({ error: 'Sem permissão de escrita no diretório especificado' });
      }
      
      STORAGE_CONFIG.externalStorage = true;
      STORAGE_CONFIG.externalPath = externalPath;
    } else {
      STORAGE_CONFIG.externalStorage = false;
      STORAGE_CONFIG.externalPath = '';
    }
    
    saveStorageConfig();
    res.json({ success: true, config: STORAGE_CONFIG });
    
  } catch (error) {
    console.error('Erro ao salvar configurações de storage:', error);
    res.status(500).json({ error: 'Erro ao salvar configurações' });
  }
});

// ROTAS DE CONTATOS
app.get('/api/contacts', requireAuth, (req, res) => {
  try {
    const contacts = dataManager.getContacts(req.session.user.id);
    res.json(contacts);
  } catch (error) {
    console.error('Erro ao buscar contatos:', error);
    res.status(500).json({ error: 'Erro ao buscar contatos' });
  }
});

app.post('/api/contacts', requireAuth, (req, res) => {
  const { name, email, phone, notes } = req.body;
  
  try {
    const result = dataManager.addContact(req.session.user.id, name, email, phone, notes);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Erro ao criar contato:', error);
    res.status(500).json({ error: 'Erro ao criar contato' });
  }
});

app.delete('/api/contacts/:id', requireAuth, (req, res) => {
  try {
    const success = dataManager.deleteContact(req.params.id, req.session.user.id);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Contato não encontrado' });
    }
  } catch (error) {
    console.error('Erro ao deletar contato:', error);
    res.status(500).json({ error: 'Erro ao deletar contato' });
  }
});

// ROTAS DO CALENDÁRIO
app.get('/api/calendar/events', requireAuth, (req, res) => {
  try {
    const events = dataManager.getEvents(req.session.user.id);
    res.json(events);
  } catch (error) {
    console.error('Erro ao buscar eventos:', error);
    res.status(500).json({ error: 'Erro ao buscar eventos' });
  }
});

app.post('/api/calendar/events', requireAuth, (req, res) => {
  const { title, description, start_date, end_date, all_day } = req.body;
  
  try {
    const result = dataManager.addEvent(req.session.user.id, title, description, start_date, end_date, all_day);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Erro ao criar evento:', error);
    res.status(500).json({ error: 'Erro ao criar evento' });
  }
});

// ROTAS DE NOTAS
app.get('/api/notes', requireAuth, (req, res) => {
  try {
    const notes = dataManager.getNotes(req.session.user.id);
    res.json(notes);
  } catch (error) {
    console.error('Erro ao buscar notas:', error);
    res.status(500).json({ error: 'Erro ao buscar notas' });
  }
});

app.post('/api/notes', requireAuth, (req, res) => {
  const { title, content, tags } = req.body;
  
  try {
    const result = dataManager.addNote(req.session.user.id, title, content, tags);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Erro ao criar nota:', error);
    res.status(500).json({ error: 'Erro ao criar nota' });
  }
});

// CHAT COM SOCKET.IO
app.get('/api/chat/messages', requireAuth, (req, res) => {
  try {
    const messages = dataManager.getChatMessages(50);
    res.json(messages);
  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

io.on('connection', (socket) => {
  console.log('Usuário conectado:', socket.id);
  
  socket.on('join', (userData) => {
    socket.userData = userData;
    socket.join('chat');
  });
  
  socket.on('chat message', (data) => {
    if (socket.userData) {
      try {
        const success = dataManager.addChatMessage(socket.userData.id, socket.userData.username, data.message);
        
        if (success) {
          io.to('chat').emit('chat message', {
            username: socket.userData.username,
            message: data.message,
            created_at: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error('Erro ao salvar mensagem:', error);
      }
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Usuário desconectado:', socket.id);
  });
});

// Formatar tamanho de arquivo
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Inicializar aplicação
server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🚀 CLOUD-TERMUX SERVIDOR INICIADO');
  console.log('='.repeat(50));
  console.log(`📱 Servidor rodando na porta: ${PORT}`);
  console.log(`🌐 Acesse: http://localhost:${PORT}`);
  console.log(`👤 Login padrão: admin / admin123`);
  console.log(`🗄️ Sistema de banco: ${DB_TYPE}`);
  console.log('='.repeat(50));
  console.log('📋 Funcionalidades disponíveis:');
  console.log('   • Gerenciador de arquivos');
  console.log('   • Contatos');
  console.log('   • Calendário');
  console.log('   • Notas');
  console.log('   • Chat em tempo real');
  console.log('='.repeat(50));
  
  if (DB_TYPE === 'json') {
    console.log('💡 MODO COMPATIBILIDADE: Usando armazenamento JSON');
    console.log('   Este modo funciona em qualquer sistema sem compilação');
  }
});

module.exports = app;