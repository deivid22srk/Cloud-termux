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
const https = require('https');
const url = require('url');

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
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB limite (sem limite prático)
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
    
    // Tabela de downloads
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
  
  const uploadStartTime = Date.now();
  const uploadId = 'upload_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  
  // Emitir evento de início de upload
  io.emit('upload_started', {
    uploadId,
    fileName: file.name,
    fileSize: file.size,
    userId: req.session.user.id
  });
  
  file.mv(uploadPath, (err) => {
    const uploadEndTime = Date.now();
    const uploadDuration = (uploadEndTime - uploadStartTime) / 1000; // em segundos
    const uploadSpeed = file.size / uploadDuration; // bytes por segundo
    
    if (err) {
      io.emit('upload_error', {
        uploadId,
        error: 'Erro ao salvar arquivo'
      });
      return res.status(500).json({ error: 'Erro ao salvar arquivo' });
    }
    
    try {
      const db = new Database(DB_PATH);
      const insert = db.prepare(`INSERT INTO files (user_id, filename, original_name, size, mimetype, path) VALUES (?, ?, ?, ?, ?, ?)`);
      const result = insert.run(req.session.user.id, fileName, file.name, file.size, file.mimetype, uploadPath);
      db.close();
      
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

// ROTAS DE DOWNLOADS
app.get('/api/downloads', requireAuth, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const downloads = db.prepare('SELECT * FROM downloads WHERE user_id = ? ORDER BY created_at DESC').all(req.session.user.id);
    db.close();
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
    getFileInfo(url)
      .then(fileInfo => {
        const db = new Database(DB_PATH);
        const insert = db.prepare(`INSERT INTO downloads (user_id, url, filename, original_filename, file_size, status) VALUES (?, ?, ?, ?, ?, 'pending')`);
        const result = insert.run(req.session.user.id, fileInfo.finalUrl, fileInfo.filename, fileInfo.filename, fileInfo.fileSize);
        db.close();
        
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
        
        const db = new Database(DB_PATH);
        const insert = db.prepare(`INSERT INTO downloads (user_id, url, filename, original_filename, status) VALUES (?, ?, ?, ?, 'pending')`);
        const result = insert.run(req.session.user.id, url, filename, filename);
        db.close();
        
        startDownload(result.lastInsertRowid, url);
        
        res.json({ 
          success: true, 
          downloadId: result.lastInsertRowid,
          filename: filename,
          warning: 'Não foi possível obter informações completas do arquivo.'
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
    const db = new Database(DB_PATH);
    const download = db.prepare('SELECT * FROM downloads WHERE id = ? AND user_id = ?').get(downloadId, req.session.user.id);
    
    if (!download) {
      db.close();
      return res.status(404).json({ error: 'Download não encontrado' });
    }
    
    // Atualizar status
    const update = db.prepare('UPDATE downloads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    update.run('paused', downloadId);
    db.close();
    
    // Pausar download
    pauseDownload(downloadId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao pausar download:', error);
    res.status(500).json({ error: 'Erro ao pausar download' });
  }
});

app.post('/api/downloads/:id/resume', requireAuth, (req, res) => {
  const downloadId = req.params.id;
  
  try {
    const db = new Database(DB_PATH);
    const download = db.prepare('SELECT * FROM downloads WHERE id = ? AND user_id = ?').get(downloadId, req.session.user.id);
    
    if (!download) {
      db.close();
      return res.status(404).json({ error: 'Download não encontrado' });
    }
    
    // Atualizar status
    const update = db.prepare('UPDATE downloads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    update.run('downloading', downloadId);
    db.close();
    
    // Resumir download
    resumeDownload(downloadId, download.url, download.downloaded_size || 0);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao resumir download:', error);
    res.status(500).json({ error: 'Erro ao resumir download' });
  }
});

app.delete('/api/downloads/:id', requireAuth, (req, res) => {
  const downloadId = req.params.id;
  
  try {
    const db = new Database(DB_PATH);
    const download = db.prepare('SELECT * FROM downloads WHERE id = ? AND user_id = ?').get(downloadId, req.session.user.id);
    
    if (!download) {
      db.close();
      return res.status(404).json({ error: 'Download não encontrado' });
    }
    
    // Cancelar download se estiver ativo
    cancelDownload(downloadId);
    
    // Deletar arquivo se existir
    if (download.file_path && fs.existsSync(download.file_path)) {
      fs.unlinkSync(download.file_path);
    }
    
    // Deletar registro
    const deleteStmt = db.prepare('DELETE FROM downloads WHERE id = ?');
    deleteStmt.run(downloadId);
    db.close();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao cancelar download:', error);
    res.status(500).json({ error: 'Erro ao cancelar download' });
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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
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
            'application/json': '.json'
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
    return;
  }
  
  const downloadInfo = {
    id: downloadId,
    url: downloadUrl,
    startTime: Date.now(),
    paused: false,
    cancelled: false,
    request: null
  };
  
  activeDownloads.set(downloadId, downloadInfo);
  
  getFileInfo(downloadUrl)
    .then(fileInfo => {
      console.log('Informações do arquivo:', fileInfo);
      
      const db = new Database(DB_PATH);
      const update = db.prepare('UPDATE downloads SET filename = ?, original_filename = ?, file_size = ? WHERE id = ?');
      update.run(fileInfo.filename, fileInfo.filename, fileInfo.fileSize, downloadId);
      db.close();
      
      performDownload(downloadId, fileInfo.finalUrl, 0, fileInfo);
    })
    .catch(error => {
      console.error('Erro ao obter informações do arquivo:', error);
      handleDownloadError(downloadId, `Erro ao analisar URL: ${error.message}`);
    });
}

function performDownload(downloadId, downloadUrl, resumeFrom = 0) {
  const downloadInfo = activeDownloads.get(downloadId);
  if (!downloadInfo || downloadInfo.cancelled) return;
  
  try {
    const db = new Database(DB_PATH);
    const download = db.prepare('SELECT * FROM downloads WHERE id = ?').get(downloadId);
    
    if (!download) {
      db.close();
      return;
    }
    
    const parsedUrl = new URL(downloadUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : require('http');
    
    const fileName = download.filename;
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    const filePath = path.join(uploadDir, 'downloads_' + fileName);
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'User-Agent': 'Cloud-Termux-Downloader/1.0'
      }
    };
    
    // Adicionar cabeçalho Range para resumir download
    if (resumeFrom > 0) {
      options.headers['Range'] = `bytes=${resumeFrom}-`;
    }
    
    // Atualizar status para downloading
    const updateStatus = db.prepare('UPDATE downloads SET status = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?');
    updateStatus.run('downloading', downloadId);
    db.close();
    
    const request = httpModule.request(options, (response) => {
      if (response.statusCode === 206 || response.statusCode === 200) {
        const totalSize = parseInt(response.headers['content-length'] || '0') + resumeFrom;
        let downloadedSize = resumeFrom;
        let lastSpeedCheck = Date.now();
        let lastDownloadedSize = resumeFrom;
        
        const fileStream = fs.createWriteStream(filePath, resumeFrom > 0 ? { flags: 'a' } : {});
        
        response.on('data', (chunk) => {
          const info = activeDownloads.get(downloadId);
          if (!info || info.cancelled || info.paused) {
            fileStream.destroy();
            request.destroy();
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
              const db = new Database(DB_PATH);
              const updateProgress = db.prepare('UPDATE downloads SET downloaded_size = ?, file_size = ?, progress = ?, download_speed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
              updateProgress.run(downloadedSize, totalSize, progress, speed, downloadId);
              db.close();
              
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
            const db = new Database(DB_PATH);
            const updateComplete = db.prepare('UPDATE downloads SET status = ?, progress = 100, file_path = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
            updateComplete.run('completed', filePath, downloadId);
            db.close();
            
            activeDownloads.delete(downloadId);
            
            io.emit('download_completed', { downloadId });
          } catch (error) {
            console.error('Erro ao finalizar download:', error);
          }
        });
        
        response.on('error', (error) => {
          fileStream.destroy();
          handleDownloadError(downloadId, `Erro de resposta: ${error.message}`);
        });
        
      } else {
        handleDownloadError(downloadId, `Erro HTTP: ${response.statusCode}`);
      }
    });
    
    request.on('error', (error) => {
      handleDownloadError(downloadId, `Erro de requisição: ${error.message}`);
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
    
    if (downloadInfo.response) {
      downloadInfo.response.pause();
    }
    
    if (downloadInfo.fileStream) {
      downloadInfo.fileStream.end();
    }
    
    if (downloadInfo.request) {
      downloadInfo.request.destroy();
    }
    
    const db = new Database(DB_PATH);
    const updateStatus = db.prepare('UPDATE downloads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    updateStatus.run('paused', downloadId);
    db.close();
    
    io.emit('download_paused', { downloadId });
  }
}

function resumeDownload(downloadId, downloadUrl, resumeFrom) {
  const downloadInfo = activeDownloads.get(downloadId);
  if (downloadInfo && downloadInfo.paused && !downloadInfo.cancelled) {
    console.log(`Resumindo download ${downloadId} do byte ${resumeFrom}`);
    downloadInfo.paused = false;
    downloadInfo.request = null;
    downloadInfo.response = null;
    downloadInfo.fileStream = null;
    
    performDownload(downloadId, downloadUrl, resumeFrom);
  } else {
    console.log(`Recriando download ${downloadId}`);
    const db = new Database(DB_PATH);
    const download = db.prepare('SELECT * FROM downloads WHERE id = ?').get(downloadId);
    db.close();
    
    if (download) {
      const downloadInfo = {
        id: downloadId,
        url: downloadUrl,
        startTime: Date.now(),
        paused: false,
        cancelled: false,
        request: null
      };
      
      activeDownloads.set(downloadId, downloadInfo);
      performDownload(downloadId, downloadUrl, resumeFrom);
    }
  }
}

function cancelDownload(downloadId) {
  const downloadInfo = activeDownloads.get(downloadId);
  if (downloadInfo) {
    console.log(`Cancelando download ${downloadId}`);
    downloadInfo.cancelled = true;
    downloadInfo.paused = false;
    
    if (downloadInfo.response) {
      downloadInfo.response.destroy();
    }
    
    if (downloadInfo.fileStream) {
      downloadInfo.fileStream.destroy();
    }
    
    if (downloadInfo.request) {
      downloadInfo.request.destroy();
    }
    
    activeDownloads.delete(downloadId);
  }
}

function handleDownloadError(downloadId, errorMessage) {
  try {
    const db = new Database(DB_PATH);
    const updateError = db.prepare('UPDATE downloads SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    updateError.run('error', errorMessage, downloadId);
    db.close();
    
    activeDownloads.delete(downloadId);
    
    io.emit('download_error', { downloadId, error: errorMessage });
  } catch (error) {
    console.error('Erro ao salvar erro de download:', error);
  }
}

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