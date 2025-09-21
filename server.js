const express = require('express');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const sqlite3 = require('sqlite3').verbose();
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
  
  const db = new sqlite3.Database(DB_PATH);
  
  db.serialize(() => {
    // Tabela de usuários
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Tabela de arquivos
    db.run(`CREATE TABLE IF NOT EXISTS files (
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
    db.run(`CREATE TABLE IF NOT EXISTS contacts (
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
    db.run(`CREATE TABLE IF NOT EXISTS calendar_events (
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
    db.run(`CREATE TABLE IF NOT EXISTS notes (
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
    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
    
    // Criar usuário admin padrão
    const adminPassword = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT OR IGNORE INTO users (username, password, email) VALUES (?, ?, ?)`, 
           ['admin', adminPassword, 'admin@cloud-termux.local']);
  });
  
  db.close();
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
  
  const db = new sqlite3.Database(DB_PATH);
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    db.close();
    
    if (err) {
      return res.status(500).json({ error: 'Erro no banco de dados' });
    }
    
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
  });
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
    
    const db = new sqlite3.Database(DB_PATH);
    db.run(`INSERT INTO files (user_id, filename, original_name, size, mimetype, path) 
            VALUES (?, ?, ?, ?, ?, ?)`,
           [req.session.user.id, fileName, file.name, file.size, file.mimetype, uploadPath],
           function(err) {
             db.close();
             if (err) {
               return res.status(500).json({ error: 'Erro ao salvar informações do arquivo' });
             }
             res.json({ success: true, fileId: this.lastID, fileName: file.name });
           });
  });
});

app.get('/api/files', requireAuth, (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  db.all('SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC', 
         [req.session.user.id], (err, files) => {
    db.close();
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar arquivos' });
    }
    res.json(files);
  });
});

app.delete('/api/files/:id', requireAuth, (req, res) => {
  const fileId = req.params.id;
  const db = new sqlite3.Database(DB_PATH);
  
  db.get('SELECT * FROM files WHERE id = ? AND user_id = ?', 
         [fileId, req.session.user.id], (err, file) => {
    if (err || !file) {
      db.close();
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    
    // Deletar arquivo físico
    fs.unlink(file.path, (unlinkErr) => {
      // Continue mesmo se houver erro ao deletar o arquivo físico
    });
    
    // Deletar registro do banco
    db.run('DELETE FROM files WHERE id = ?', [fileId], (deleteErr) => {
      db.close();
      if (deleteErr) {
        return res.status(500).json({ error: 'Erro ao deletar arquivo' });
      }
      res.json({ success: true });
    });
  });
});

// ROTAS DE CONTATOS
app.get('/api/contacts', requireAuth, (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  db.all('SELECT * FROM contacts WHERE user_id = ? ORDER BY name', 
         [req.session.user.id], (err, contacts) => {
    db.close();
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar contatos' });
    }
    res.json(contacts);
  });
});

app.post('/api/contacts', requireAuth, (req, res) => {
  const { name, email, phone, notes } = req.body;
  const db = new sqlite3.Database(DB_PATH);
  
  db.run('INSERT INTO contacts (user_id, name, email, phone, notes) VALUES (?, ?, ?, ?, ?)',
         [req.session.user.id, name, email, phone, notes], function(err) {
    db.close();
    if (err) {
      return res.status(500).json({ error: 'Erro ao criar contato' });
    }
    res.json({ success: true, id: this.lastID });
  });
});

app.delete('/api/contacts/:id', requireAuth, (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  db.run('DELETE FROM contacts WHERE id = ? AND user_id = ?', 
         [req.params.id, req.session.user.id], (err) => {
    db.close();
    if (err) {
      return res.status(500).json({ error: 'Erro ao deletar contato' });
    }
    res.json({ success: true });
  });
});

// ROTAS DO CALENDÁRIO
app.get('/api/calendar/events', requireAuth, (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  db.all('SELECT * FROM calendar_events WHERE user_id = ? ORDER BY start_date', 
         [req.session.user.id], (err, events) => {
    db.close();
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar eventos' });
    }
    res.json(events);
  });
});

app.post('/api/calendar/events', requireAuth, (req, res) => {
  const { title, description, start_date, end_date, all_day } = req.body;
  const db = new sqlite3.Database(DB_PATH);
  
  db.run(`INSERT INTO calendar_events (user_id, title, description, start_date, end_date, all_day) 
          VALUES (?, ?, ?, ?, ?, ?)`,
         [req.session.user.id, title, description, start_date, end_date, all_day ? 1 : 0], 
         function(err) {
    db.close();
    if (err) {
      return res.status(500).json({ error: 'Erro ao criar evento' });
    }
    res.json({ success: true, id: this.lastID });
  });
});

// ROTAS DE NOTAS
app.get('/api/notes', requireAuth, (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  db.all('SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC', 
         [req.session.user.id], (err, notes) => {
    db.close();
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar notas' });
    }
    res.json(notes);
  });
});

app.post('/api/notes', requireAuth, (req, res) => {
  const { title, content, tags } = req.body;
  const db = new sqlite3.Database(DB_PATH);
  
  db.run('INSERT INTO notes (user_id, title, content, tags) VALUES (?, ?, ?, ?)',
         [req.session.user.id, title, content, tags], function(err) {
    db.close();
    if (err) {
      return res.status(500).json({ error: 'Erro ao criar nota' });
    }
    res.json({ success: true, id: this.lastID });
  });
});

// CHAT COM SOCKET.IO
app.get('/api/chat/messages', requireAuth, (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  db.all('SELECT * FROM chat_messages ORDER BY created_at ASC LIMIT 50', (err, messages) => {
    db.close();
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar mensagens' });
    }
    res.json(messages);
  });
});

io.on('connection', (socket) => {
  console.log('Usuário conectado:', socket.id);
  
  socket.on('join', (userData) => {
    socket.userData = userData;
    socket.join('chat');
  });
  
  socket.on('chat message', (data) => {
    if (socket.userData) {
      const db = new sqlite3.Database(DB_PATH);
      db.run('INSERT INTO chat_messages (user_id, username, message) VALUES (?, ?, ?)',
             [socket.userData.id, socket.userData.username, data.message], (err) => {
        db.close();
        if (!err) {
          io.to('chat').emit('chat message', {
            username: socket.userData.username,
            message: data.message,
            created_at: new Date().toISOString()
          });
        }
      });
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