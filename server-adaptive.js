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
const https = require('https');
const url = require('url');

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
      chat_messages: [],
      downloads: []
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
        
        db.exec(`CREATE TABLE IF NOT EXISTS downloads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          url TEXT NOT NULL,
          filename TEXT NOT NULL,
          original_filename TEXT,
          file_path TEXT,
          file_size INTEGER DEFAULT 0,
          downloaded_size INTEGER DEFAULT 0,
          download_speed REAL DEFAULT 0,
          status TEXT DEFAULT 'pending',
          progress REAL DEFAULT 0,
          error_message TEXT,
          started_at DATETIME,
          completed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
  
  // === MÉTODOS PARA DOWNLOADS ===
  getDownloads(userId) {
    if (DB_TYPE === 'json') {
      return this.data.downloads.filter(d => d.user_id === userId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (DB_TYPE === 'better-sqlite3') {
      return db.prepare('SELECT * FROM downloads WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    }
    return [];
  }
  
  getDownload(downloadId, userId) {
    if (DB_TYPE === 'json') {
      return this.data.downloads.find(d => d.id == downloadId && d.user_id == userId);
    } else if (DB_TYPE === 'better-sqlite3') {
      return db.prepare('SELECT * FROM downloads WHERE id = ? AND user_id = ?').get(downloadId, userId);
    }
    return null;
  }
  
  addDownload(userId, url, filename, originalFilename) {
    const downloadData = {
      user_id: userId,
      url: url,
      filename: filename,
      original_filename: originalFilename || filename,
      file_path: null,
      file_size: 0,
      downloaded_size: 0,
      download_speed: 0,
      status: 'pending',
      progress: 0,
      error_message: null,
      started_at: null,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    if (DB_TYPE === 'json') {
      downloadData.id = this.data.downloads.length > 0 ? Math.max(...this.data.downloads.map(d => d.id)) + 1 : 1;
      this.data.downloads.push(downloadData);
      this.saveJsonData();
      return { lastInsertRowid: downloadData.id };
    } else if (DB_TYPE === 'better-sqlite3') {
      const insert = db.prepare(`INSERT INTO downloads (user_id, url, filename, original_filename, status) VALUES (?, ?, ?, ?, 'pending')`);
      return insert.run(userId, url, filename, originalFilename);
    }
  }
  
  updateDownload(downloadId, updates) {
    if (DB_TYPE === 'json') {
      const downloadIndex = this.data.downloads.findIndex(d => d.id == downloadId);
      if (downloadIndex !== -1) {
        this.data.downloads[downloadIndex] = {
          ...this.data.downloads[downloadIndex],
          ...updates,
          updated_at: new Date().toISOString()
        };
        this.saveJsonData();
        return true;
      }
      return false;
    } else if (DB_TYPE === 'better-sqlite3') {
      const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      const values = Object.values(updates);
      const query = `UPDATE downloads SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      const result = db.prepare(query).run(...values, downloadId);
      return result.changes > 0;
    }
  }
  
  deleteDownload(downloadId, userId) {
    if (DB_TYPE === 'json') {
      const downloadIndex = this.data.downloads.findIndex(d => d.id == downloadId && d.user_id == userId);
      if (downloadIndex !== -1) {
        const download = this.data.downloads[downloadIndex];
        this.data.downloads.splice(downloadIndex, 1);
        this.saveJsonData();
        return download;
      }
      return null;
    } else if (DB_TYPE === 'better-sqlite3') {
      const download = db.prepare('SELECT * FROM downloads WHERE id = ? AND user_id = ?').get(downloadId, userId);
      if (download) {
        db.prepare('DELETE FROM downloads WHERE id = ?').run(downloadId);
      }
      return download;
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

// Configuração do Express com otimizações para Termux
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Configurações de timeout otimizadas para Termux
app.use((req, res, next) => {
  // Timeout aumentado para uploads/downloads grandes
  req.setTimeout(600000); // 10 minutos
  res.setTimeout(600000);
  
  // Headers de performance
  res.setHeader('X-Powered-By', 'Cloud-Termux');
  res.setHeader('Keep-Alive', 'timeout=300, max=1000');
  
  next();
});
app.use(fileUpload({
  createParentPath: true,
  limits: { 
    fileSize: 50 * 1024 * 1024 * 1024, // 50GB limite (sem limite prático)
    files: 10, // Múltiplos arquivos simultâneos
    parts: 1000,
    fieldSize: 2 * 1024 * 1024 // 2MB para campos
  },
  useTempFiles: true,
  tempFileDir: path.join(__dirname, 'temp'), // Usar pasta local ao invés de /tmp/
  uploadTimeout: 600000, // 10 minutos timeout
  debug: false,
  // Configurações otimizadas para Termux
  parseNested: true,
  preserveExtension: 4,
  safeFileNames: true,
  abortOnLimit: false,
  responseOnLimit: 'Arquivo muito grande',
  // Buffer otimizado para melhor throughput
  highWaterMark: 2 * 1024 * 1024 // 2MB buffer
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
  
  const uploadStartTime = Date.now();
  const uploadId = 'upload_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  
  // Emitir evento de início de upload
  io.emit('upload_started', {
    uploadId,
    fileName: file.name,
    fileSize: file.size,
    userId: req.session.user.id
  });
  
  // Criar pasta se não existir
  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
  } catch (error) {
    io.emit('upload_error', {
      uploadId,
      error: 'Erro ao criar pasta de destino: ' + error.message
    });
    return res.status(500).json({ error: 'Erro ao criar pasta de destino: ' + error.message });
  }
  
  file.mv(uploadPath, (err) => {
    const uploadEndTime = Date.now();
    const uploadDuration = (uploadEndTime - uploadStartTime) / 1000; // em segundos
    const uploadSpeed = file.size / uploadDuration; // bytes por segundo
    
    if (err) {
      io.emit('upload_error', {
        uploadId,
        error: 'Erro ao salvar arquivo: ' + err.message
      });
      return res.status(500).json({ error: 'Erro ao salvar arquivo: ' + err.message });
    }
    
    try {
      const result = dataManager.addFile(req.session.user.id, fileName, file.name, file.size, file.mimetype, uploadPath, folder);
      
      // Emitir evento de conclusão de upload com velocidade
      io.emit('upload_completed', {
        uploadId,
        fileName: file.name,
        fileSize: file.size,
        uploadSpeed,
        duration: uploadDuration,
        userId: req.session.user.id
      });
      
      res.json({ 
        success: true, 
        fileId: result.lastInsertRowid, 
        fileName: file.name, 
        uploadSpeed: uploadSpeed,
        duration: uploadDuration
      });
    } catch (error) {
      console.error('Erro ao salvar arquivo:', error);
      io.emit('upload_error', {
        uploadId,
        error: 'Erro ao salvar informações do arquivo'
      });
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

// ROTAS DE DOWNLOADS
app.get('/api/downloads', requireAuth, (req, res) => {
  try {
    const downloads = dataManager.getDownloads(req.session.user.id);
    res.json(downloads);
  } catch (error) {
    console.error('Erro ao buscar downloads:', error);
    res.status(500).json({ error: 'Erro ao buscar downloads' });
  }
});

app.post('/api/downloads', requireAuth, (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL é obrigatória' });
  }
  
  // Validar URL
  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({ error: 'URL inválida' });
  }
  
  try {
    // Primeiro, obter informações do arquivo
    getFileInfo(url)
      .then(fileInfo => {
        // Criar download com informações corretas
        const result = dataManager.addDownload(
          req.session.user.id, 
          fileInfo.finalUrl, 
          fileInfo.filename, 
          fileInfo.filename
        );
        
        // Atualizar com informações do arquivo
        dataManager.updateDownload(result.lastInsertRowid, {
          file_size: fileInfo.fileSize,
          original_filename: fileInfo.filename
        });
        
        // Iniciar download
        startDownload(result.lastInsertRowid, fileInfo.finalUrl);
        
        res.json({ 
          success: true, 
          downloadId: result.lastInsertRowid,
          filename: fileInfo.filename,
          fileSize: fileInfo.fileSize
        });
      })
      .catch(error => {
        console.error('Erro ao analisar URL:', error);
        
        // Fallback: criar download mesmo sem informações completas
        let filename = path.basename(new URL(url).pathname);
        if (!filename || filename === '/') {
          filename = 'download_' + Date.now() + '.bin';
        }
        
        const result = dataManager.addDownload(req.session.user.id, url, filename, filename);
        
        // Tentar iniciar download mesmo assim
        startDownload(result.lastInsertRowid, url);
        
        res.json({ 
          success: true, 
          downloadId: result.lastInsertRowid,
          filename: filename,
          warning: 'Não foi possível obter informações completas do arquivo. Download iniciado.'
        });
      });
      
  } catch (error) {
    console.error('Erro ao criar download:', error);
    res.status(500).json({ error: 'Erro ao criar download' });
  }
});

app.post('/api/downloads/:id/pause', requireAuth, (req, res) => {
  const downloadId = req.params.id;
  
  try {
    const download = dataManager.getDownload(downloadId, req.session.user.id);
    
    if (!download) {
      return res.status(404).json({ error: 'Download não encontrado' });
    }
    
    if (download.status !== 'downloading') {
      return res.status(400).json({ error: 'Download não está ativo para ser pausado' });
    }
    
    // Pausar download
    pauseDownload(downloadId);
    
    res.json({ success: true, message: 'Download pausado' });
  } catch (error) {
    console.error('Erro ao pausar download:', error);
    res.status(500).json({ error: 'Erro ao pausar download' });
  }
});

app.post('/api/downloads/:id/resume', requireAuth, (req, res) => {
  const downloadId = req.params.id;
  
  try {
    const download = dataManager.getDownload(downloadId, req.session.user.id);
    
    if (!download) {
      return res.status(404).json({ error: 'Download não encontrado' });
    }
    
    if (download.status !== 'paused' && download.status !== 'error') {
      return res.status(400).json({ error: 'Download não pode ser resumido' });
    }
    
    // Atualizar status
    dataManager.updateDownload(downloadId, { 
      status: 'downloading',
      error_message: null 
    });
    
    // Resumir download
    resumeDownload(downloadId, download.url, download.downloaded_size || 0);
    
    res.json({ success: true, message: 'Download resumido' });
  } catch (error) {
    console.error('Erro ao resumir download:', error);
    res.status(500).json({ error: 'Erro ao resumir download' });
  }
});

app.delete('/api/downloads/:id', requireAuth, (req, res) => {
  const downloadId = req.params.id;
  
  try {
    const download = dataManager.deleteDownload(downloadId, req.session.user.id);
    
    if (!download) {
      return res.status(404).json({ error: 'Download não encontrado' });
    }
    
    // Cancelar download se estiver ativo
    cancelDownload(downloadId);
    
    // Deletar arquivo se existir
    if (download.file_path && fs.existsSync(download.file_path)) {
      try {
        fs.unlinkSync(download.file_path);
        console.log(`Arquivo de download removido: ${download.file_path}`);
      } catch (unlinkError) {
        console.error('Erro ao remover arquivo:', unlinkError);
      }
    }
    
    io.emit('download_cancelled', { downloadId });
    
    res.json({ success: true, message: 'Download cancelado e removido' });
  } catch (error) {
    console.error('Erro ao cancelar download:', error);
    res.status(500).json({ error: 'Erro ao cancelar download' });
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
    
    // Headers otimizados para performance no Termux
    res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
    res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
    res.setHeader('Content-Length', file.size);
    
    // Headers de cache para melhor performance
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 ano
    res.setHeader('Last-Modified', new Date(file.created_at).toUTCString());
    
    // Headers de compressão se suportado
    res.setHeader('Accept-Ranges', 'bytes');
    
    // Configurações otimizadas para Termux
    const streamOptions = {
      highWaterMark: 1024 * 1024, // Buffer de 1MB para melhor throughput
      autoClose: true,
      emitClose: true
    };
    
    // Suporte a Range requests para downloads resumíveis
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : file.size - 1;
      const chunksize = (end - start) + 1;
      
      res.status(206); // Partial Content
      res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
      res.setHeader('Content-Length', chunksize);
      
      streamOptions.start = start;
      streamOptions.end = end;
    }
    
    // Stream otimizado
    const fileStream = fs.createReadStream(file.path, streamOptions);
    
    // Error handling
    fileStream.on('error', (error) => {
      console.error('Erro no stream de arquivo:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erro ao ler arquivo' });
      }
    });
    
    // Pipeline otimizado para melhor performance
    fileStream.pipe(res);
    
    res.on('close', () => {
      fileStream.destroy();
    });
    
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
  
  // Eventos de upload em tempo real
  socket.on('upload_progress', (data) => {
    if (socket.userData) {
      socket.broadcast.emit('upload_progress', {
        ...data,
        userId: socket.userData.id
      });
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

// === GERENCIAMENTO DE DOWNLOADS ===
const activeDownloads = new Map();

// Função para obter informações do arquivo via HTTP HEAD
function getFileInfo(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : require('http');
    
    let redirectCount = 0;
    
    function makeRequest(currentUrl) {
      const urlObj = new URL(currentUrl);
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'HEAD',
        headers: {
          'User-Agent': 'Cloud-Termux-Downloader/1.0',
          'Accept': '*/*'
        },
        timeout: 10000
      };
      
      const req = (urlObj.protocol === 'https:' ? https : require('http')).request(options, (res) => {
        // Seguir redirecionamentos
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (redirectCount >= maxRedirects) {
            reject(new Error('Muitos redirecionamentos'));
            return;
          }
          redirectCount++;
          const redirectUrl = new URL(res.headers.location, currentUrl).href;
          console.log(`Redirecionando para: ${redirectUrl}`);
          makeRequest(redirectUrl);
          return;
        }
        
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        
        let filename = 'download_' + Date.now();
        
        // Tentar obter nome do Content-Disposition
        if (res.headers['content-disposition']) {
          const match = res.headers['content-disposition'].match(/filename[^;=\n]*=['"]?([^'";\n]*)['"]?/);
          if (match && match[1]) {
            filename = match[1].trim();
          }
        }
        
        // Se não encontrou, tentar extrair da URL final
        if (filename.startsWith('download_')) {
          const urlFilename = path.basename(urlObj.pathname);
          if (urlFilename && urlFilename !== '/' && urlFilename.includes('.')) {
            filename = urlFilename;
          }
        }
        
        // Se ainda não tem extensão, tentar deduzir do Content-Type
        if (!filename.includes('.') && res.headers['content-type']) {
          const contentType = res.headers['content-type'].split(';')[0];
          const extensions = {
            'application/pdf': '.pdf',
            'application/zip': '.zip',
            'application/x-zip-compressed': '.zip',
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'video/mp4': '.mp4',
            'audio/mpeg': '.mp3',
            'text/plain': '.txt',
            'application/json': '.json',
            'application/xml': '.xml'
          };
          
          if (extensions[contentType]) {
            filename += extensions[contentType];
          }
        }
        
        resolve({
          finalUrl: currentUrl,
          filename: filename,
          fileSize: parseInt(res.headers['content-length'] || '0'),
          contentType: res.headers['content-type'] || 'application/octet-stream',
          acceptRanges: res.headers['accept-ranges'] === 'bytes'
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout na requisição'));
      });
      req.end();
    }
    
    makeRequest(url);
  });
}

function startDownload(downloadId, downloadUrl) {
  if (activeDownloads.has(downloadId)) {
    return; // Download já está ativo
  }
  
  // Obter informações do download para ter o userId
  const download = dataManager.data.downloads ? dataManager.data.downloads.find(d => d.id == downloadId) : null;
  if (!download && DB_TYPE === 'better-sqlite3') {
    download = db.prepare('SELECT * FROM downloads WHERE id = ?').get(downloadId);
  }
  
  if (!download) {
    console.error('Download não encontrado:', downloadId);
    return;
  }
  
  const downloadInfo = {
    id: downloadId,
    url: downloadUrl,
    userId: download.user_id,
    startTime: Date.now(),
    paused: false,
    cancelled: false,
    request: null // Vamos armazenar a requisição aqui
  };
  
  activeDownloads.set(downloadId, downloadInfo);
  
  // Primeiro, obter informações do arquivo
  getFileInfo(downloadUrl)
    .then(fileInfo => {
      console.log('Informações do arquivo:', fileInfo);
      
      // Atualizar dados no banco
      dataManager.updateDownload(downloadId, {
        filename: fileInfo.filename,
        original_filename: fileInfo.filename,
        file_size: fileInfo.fileSize
      });
      
      // Iniciar o download
      performDownload(downloadId, fileInfo.finalUrl, 0, fileInfo);
    })
    .catch(error => {
      console.error('Erro ao obter informações do arquivo:', error);
      handleDownloadError(downloadId, `Erro ao analisar URL: ${error.message}`);
    });
}

function performDownload(downloadId, downloadUrl, resumeFrom = 0, fileInfo = null) {
  const downloadInfo = activeDownloads.get(downloadId);
  if (!downloadInfo || downloadInfo.cancelled) return;
  
  try {
    const download = dataManager.getDownload(downloadId, downloadInfo.userId);
    
    if (!download) {
      return;
    }
    
    const parsedUrl = new URL(downloadUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : require('http');
    
    const fileName = fileInfo ? fileInfo.filename : download.filename;
    const baseUploadPath = STORAGE_CONFIG.externalStorage ? STORAGE_CONFIG.externalPath : STORAGE_CONFIG.uploadsPath;
    const filePath = path.join(baseUploadPath, 'downloads_' + fileName);
    
    if (!fs.existsSync(baseUploadPath)) {
      fs.mkdirSync(baseUploadPath, { recursive: true });
    }
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity', // Não usar compressão para calcular progresso corretamente
        'Connection': 'keep-alive'
      },
      timeout: 30000
    };
    
    // Adicionar cabeçalho Range para resumir download
    if (resumeFrom > 0) {
      options.headers['Range'] = `bytes=${resumeFrom}-`;
    }
    
    // Atualizar status para downloading
    dataManager.updateDownload(downloadId, { 
      status: 'downloading', 
      started_at: new Date().toISOString() 
    });
    
    const request = httpModule.request(options, (response) => {
      // Seguir redirecionamentos automaticamente
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        console.log(`Redirecionando download ${downloadId} para:`, response.headers.location);
        const redirectUrl = new URL(response.headers.location, downloadUrl).href;
        
        // Atualizar URL no download info
        downloadInfo.url = redirectUrl;
        
        // Fazer nova requisição com a URL redirecionada
        setTimeout(() => {
          performDownload(downloadId, redirectUrl, resumeFrom, fileInfo);
        }, 100);
        return;
      }
      
      if (response.statusCode === 206 || response.statusCode === 200) {
        const contentLength = parseInt(response.headers['content-length'] || '0');
        const totalSize = response.statusCode === 206 ? contentLength + resumeFrom : contentLength;
        let downloadedSize = resumeFrom;
        let lastSpeedCheck = Date.now();
        let lastDownloadedSize = resumeFrom;
        
        // Atualizar nome do arquivo se vier do Content-Disposition
        if (!fileInfo && response.headers['content-disposition']) {
          const match = response.headers['content-disposition'].match(/filename[^;=\n]*=['"]?([^'";\n]*)['"]?/);
          if (match && match[1]) {
            const newFilename = match[1].trim();
            dataManager.updateDownload(downloadId, {
              filename: newFilename,
              original_filename: newFilename
            });
          }
        }
        
        const fileStream = fs.createWriteStream(filePath, resumeFrom > 0 ? { flags: 'a' } : {});
        
        // Armazenar referência da requisição para poder cancelá-la
        downloadInfo.request = request;
        downloadInfo.response = response;
        downloadInfo.fileStream = fileStream;
        
        response.on('data', (chunk) => {
          const info = activeDownloads.get(downloadId);
          if (!info || info.cancelled) {
            fileStream.destroy();
            request.destroy();
            return;
          }
          
          if (info.paused) {
            // Se pausado, parar o stream mas manter a conexão
            response.pause();
            fileStream.end();
            return;
          }
          
          downloadedSize += chunk.length;
          fileStream.write(chunk);
          
          // Calcular velocidade a cada segundo
          const currentTime = Date.now();
          if (currentTime - lastSpeedCheck > 1000) {
            const timeDiff = (currentTime - lastSpeedCheck) / 1000;
            const sizeDiff = downloadedSize - lastDownloadedSize;
            const speed = sizeDiff / timeDiff; // bytes por segundo
            
            const progress = totalSize > 0 ? (downloadedSize / totalSize) * 100 : 0;
            
            // Atualizar banco de dados
            try {
              dataManager.updateDownload(downloadId, {
                downloaded_size: downloadedSize,
                file_size: totalSize,
                progress: progress,
                download_speed: speed
              });
              
              // Emitir evento via Socket.IO
              io.emit('download_progress', {
                downloadId,
                downloadedSize,
                totalSize,
                progress,
                speed
              });
            } catch (dbError) {
              console.error('Erro ao atualizar progresso:', dbError);
            }
            
            lastSpeedCheck = currentTime;
            lastDownloadedSize = downloadedSize;
          }
        });
        
        response.on('end', () => {
          fileStream.end();
          
          // Download concluído
          try {
            dataManager.updateDownload(downloadId, {
              status: 'completed',
              progress: 100,
              file_path: filePath,
              completed_at: new Date().toISOString()
            });
            
            activeDownloads.delete(downloadId);
            
            io.emit('download_completed', { downloadId });
            console.log(`Download ${downloadId} concluído:`, fileName);
          } catch (error) {
            console.error('Erro ao finalizar download:', error);
          }
        });
        
        response.on('error', (error) => {
          fileStream.destroy();
          handleDownloadError(downloadId, `Erro de resposta: ${error.message}`);
        });
        
      } else {
        handleDownloadError(downloadId, `Erro HTTP: ${response.statusCode} - ${response.statusMessage}`);
      }
    });
    
    request.on('error', (error) => {
      handleDownloadError(downloadId, `Erro de requisição: ${error.message}`);
    });
    
    request.on('timeout', () => {
      request.destroy();
      handleDownloadError(downloadId, 'Timeout na requisição');
    });
    
    request.end();
    
  } catch (error) {
    handleDownloadError(downloadId, `Erro geral: ${error.message}`);
  }
}

function pauseDownload(downloadId) {
  const downloadInfo = activeDownloads.get(downloadId);
  if (downloadInfo && !downloadInfo.paused && !downloadInfo.cancelled) {
    console.log(`Pausando download ${downloadId}`);
    downloadInfo.paused = true;
    
    // Pausar response stream se existir
    if (downloadInfo.response) {
      downloadInfo.response.pause();
    }
    
    // Fechar file stream se existir
    if (downloadInfo.fileStream) {
      downloadInfo.fileStream.end();
    }
    
    // Destruir requisição
    if (downloadInfo.request) {
      downloadInfo.request.destroy();
    }
    
    // Atualizar status no banco
    dataManager.updateDownload(downloadId, { status: 'paused' });
    
    io.emit('download_paused', { downloadId });
  }
}

function resumeDownload(downloadId, downloadUrl, resumeFrom) {
  const downloadInfo = activeDownloads.get(downloadId);
  if (downloadInfo && downloadInfo.paused && !downloadInfo.cancelled) {
    console.log(`Resumindo download ${downloadId} do byte ${resumeFrom}`);
    downloadInfo.paused = false;
    
    // Limpar referências antigas
    downloadInfo.request = null;
    downloadInfo.response = null;
    downloadInfo.fileStream = null;
    
    // Recomeçar download do ponto onde parou
    performDownload(downloadId, downloadUrl, resumeFrom);
  } else {
    // Se não está no mapa de downloads ativos, recriar
    console.log(`Recriando download ${downloadId}`);
    startDownload(downloadId, downloadUrl);
  }
}

function cancelDownload(downloadId) {
  const downloadInfo = activeDownloads.get(downloadId);
  if (downloadInfo) {
    console.log(`Cancelando download ${downloadId}`);
    downloadInfo.cancelled = true;
    downloadInfo.paused = false;
    
    // Parar response stream
    if (downloadInfo.response) {
      downloadInfo.response.destroy();
    }
    
    // Fechar file stream
    if (downloadInfo.fileStream) {
      downloadInfo.fileStream.destroy();
    }
    
    // Destruir requisição
    if (downloadInfo.request) {
      downloadInfo.request.destroy();
    }
    
    activeDownloads.delete(downloadId);
  }
}

function handleDownloadError(downloadId, errorMessage) {
  try {
    dataManager.updateDownload(downloadId, {
      status: 'error',
      error_message: errorMessage
    });
    
    activeDownloads.delete(downloadId);
    
    io.emit('download_error', { downloadId, error: errorMessage });
  } catch (error) {
    console.error('Erro ao salvar erro de download:', error);
  }
}

// Configurações de performance para o servidor HTTP no Termux
server.keepAliveTimeout = 300000; // 5 minutos
server.headersTimeout = 310000; // Maior que keepAliveTimeout
server.requestTimeout = 600000; // 10 minutos para uploads grandes
server.timeout = 600000; // 10 minutos timeout geral
server.maxConnections = 1000; // Conexões simultâneas

// Configurações de buffer para melhor throughput
server.maxHeaderSize = 16384; // 16KB para headers grandes

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