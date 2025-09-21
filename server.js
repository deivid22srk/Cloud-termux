const express = require('express');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIO = require('socket.io');
const mime = require('mime');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 8080;
const DB_PATH = path.join(__dirname, 'database', 'cloud.db');

// Middleware de segurança
app.use(helmet({
  contentSecurityPolicy: false // Desabilitado para permitir inline scripts
}));
app.use(compression());
app.use(cors());

// Configuração do Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(fileUpload({
  createParentPath: true,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limite
  useTempFiles: true,
  tempFileDir: '/tmp/',
  debug: false
}));

// Sessões
app.use(session({
  secret: 'cloud-termux-secret-' + Math.random().toString(36),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
}));

// Inicializar banco de dados
function initDatabase() {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  
  const db = new Database(DB_PATH);
  
  // Criar tabelas
  try {
    // Tabela de usuários
    db.exec(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Tabela de arquivos
    db.exec(`CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      mimetype TEXT,
      path TEXT NOT NULL,
      shared BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
    
    // Tabela de contatos
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
    
    // Tabela de eventos do calendário
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
    
    // Tabela de notas
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
    
    // Tabela de mensagens do chat
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
    
  } catch (error) {
    console.error('Erro ao inicializar banco de dados:', error);
  } finally {
    db.close();
  }
}

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
    const db = new Database(DB_PATH);
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    db.close();
    
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
    res.status(500).json({ error: 'Erro no banco de dados' });
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

// API para informações do usuário
app.get('/api/user', requireAuth, (req, res) => {
  res.json(req.session.user);
});

// ROTAS DE ARQUIVOS
app.post('/api/upload', requireAuth, (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }
  
  const file = req.files.file;
  const fileName = Date.now() + '-' + file.name;
  const uploadPath = path.join(__dirname, 'public', 'uploads', fileName);
  
  file.mv(uploadPath, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao salvar arquivo' });
    }
    
    try {
      const db = new Database(DB_PATH);
      const insert = db.prepare(`INSERT INTO files (user_id, filename, original_name, size, mimetype, path) VALUES (?, ?, ?, ?, ?, ?)`);
      const result = insert.run(req.session.user.id, fileName, file.name, file.size, file.mimetype, uploadPath);
      db.close();
      
      res.json({ success: true, fileId: result.lastInsertRowid, fileName: file.name });
    } catch (error) {
      console.error('Erro ao salvar arquivo:', error);
      res.status(500).json({ error: 'Erro ao salvar informações do arquivo' });
    }
  });
});

app.get('/api/files', requireAuth, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const files = db.prepare('SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC').all(req.session.user.id);
    db.close();
    res.json(files);
  } catch (error) {
    console.error('Erro ao buscar arquivos:', error);
    res.status(500).json({ error: 'Erro ao buscar arquivos' });
  }
});

app.delete('/api/files/:id', requireAuth, (req, res) => {
  const fileId = req.params.id;
  
  try {
    const db = new Database(DB_PATH);
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(fileId, req.session.user.id);
    
    if (!file) {
      db.close();
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    
    // Deletar arquivo físico
    fs.unlink(file.path, (unlinkErr) => {
      // Continue mesmo se houver erro ao deletar o arquivo físico
    });
    
    // Deletar registro do banco
    const deleteStmt = db.prepare('DELETE FROM files WHERE id = ?');
    deleteStmt.run(fileId);
    db.close();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar arquivo:', error);
    res.status(500).json({ error: 'Erro ao deletar arquivo' });
  }
});

// ROTAS DE CONTATOS
app.get('/api/contacts', requireAuth, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const contacts = db.prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY name').all(req.session.user.id);
    db.close();
    res.json(contacts);
  } catch (error) {
    console.error('Erro ao buscar contatos:', error);
    res.status(500).json({ error: 'Erro ao buscar contatos' });
  }
});

app.post('/api/contacts', requireAuth, (req, res) => {
  const { name, email, phone, notes } = req.body;
  
  try {
    const db = new Database(DB_PATH);
    const insert = db.prepare('INSERT INTO contacts (user_id, name, email, phone, notes) VALUES (?, ?, ?, ?, ?)');
    const result = insert.run(req.session.user.id, name, email, phone, notes);
    db.close();
    
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Erro ao criar contato:', error);
    res.status(500).json({ error: 'Erro ao criar contato' });
  }
});

app.delete('/api/contacts/:id', requireAuth, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const deleteStmt = db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?');
    deleteStmt.run(req.params.id, req.session.user.id);
    db.close();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar contato:', error);
    res.status(500).json({ error: 'Erro ao deletar contato' });
  }
});

// ROTAS DO CALENDÁRIO
app.get('/api/calendar/events', requireAuth, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const events = db.prepare('SELECT * FROM calendar_events WHERE user_id = ? ORDER BY start_date').all(req.session.user.id);
    db.close();
    res.json(events);
  } catch (error) {
    console.error('Erro ao buscar eventos:', error);
    res.status(500).json({ error: 'Erro ao buscar eventos' });
  }
});

app.post('/api/calendar/events', requireAuth, (req, res) => {
  const { title, description, start_date, end_date, all_day } = req.body;
  
  try {
    const db = new Database(DB_PATH);
    const insert = db.prepare(`INSERT INTO calendar_events (user_id, title, description, start_date, end_date, all_day) VALUES (?, ?, ?, ?, ?, ?)`);
    const result = insert.run(req.session.user.id, title, description, start_date, end_date, all_day ? 1 : 0);
    db.close();
    
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Erro ao criar evento:', error);
    res.status(500).json({ error: 'Erro ao criar evento' });
  }
});

// ROTAS DE NOTAS
app.get('/api/notes', requireAuth, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const notes = db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC').all(req.session.user.id);
    db.close();
    res.json(notes);
  } catch (error) {
    console.error('Erro ao buscar notas:', error);
    res.status(500).json({ error: 'Erro ao buscar notas' });
  }
});

app.post('/api/notes', requireAuth, (req, res) => {
  const { title, content, tags } = req.body;
  
  try {
    const db = new Database(DB_PATH);
    const insert = db.prepare('INSERT INTO notes (user_id, title, content, tags) VALUES (?, ?, ?, ?)');
    const result = insert.run(req.session.user.id, title, content, tags);
    db.close();
    
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Erro ao criar nota:', error);
    res.status(500).json({ error: 'Erro ao criar nota' });
  }
});

// CHAT COM SOCKET.IO
app.get('/api/chat/messages', requireAuth, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const messages = db.prepare('SELECT * FROM chat_messages ORDER BY created_at ASC LIMIT 50').all();
    db.close();
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
        const db = new Database(DB_PATH);
        const insert = db.prepare('INSERT INTO chat_messages (user_id, username, message) VALUES (?, ?, ?)');
        insert.run(socket.userData.id, socket.userData.username, data.message);
        db.close();
        
        io.to('chat').emit('chat message', {
          username: socket.userData.username,
          message: data.message,
          created_at: new Date().toISOString()
        });
      } catch (error) {
        console.error('Erro ao salvar mensagem:', error);
      }
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Usuário desconectado:', socket.id);
  });
});

// Inicializar aplicação
initDatabase();

server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🚀 CLOUD-TERMUX SERVIDOR INICIADO');
  console.log('='.repeat(50));
  console.log(`📱 Servidor rodando na porta: ${PORT}`);
  console.log(`🌐 Acesse: http://localhost:${PORT}`);
  console.log(`👤 Login padrão: admin / admin123`);
  console.log('='.repeat(50));
  console.log('📋 Funcionalidades disponíveis:');
  console.log('   • Gerenciador de arquivos');
  console.log('   • Contatos');
  console.log('   • Calendário');
  console.log('   • Notas');
  console.log('   • Chat em tempo real');
  console.log('='.repeat(50));
});

module.exports = app;