const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config({ path: __dirname + '/config.env' });

// Ensure JWT_SECRET is defined
if (!process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not defined. Please set it in config.env');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? 'https://yourdomain.com' : true,
    methods: ['GET', 'POST']
  }
});
const PORT = process.env.PORT || 5000;

// Sprint Game State Management
const sprintGames = new Map(); // gameId -> game state
const activePlayers = new Map(); // socketId -> player info

// Initialize SQLite database
const db = new sqlite3.Database('./sokoban.db', (err) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Connected to SQLite database');
    initializeTables();
  }
});

// Initialize database tables
function initializeTables() {
  // Create tables sequentially to avoid timing issues
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'player' CHECK(role IN ('anonymous', 'player', 'admin')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Error creating users table:', err);
      } else {
        console.log('✅ Users table created');
      }
    });

    // Puzzles table
    db.run(`
      CREATE TABLE IF NOT EXISTS puzzles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        layout TEXT NOT NULL,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating puzzles table:', err);
      } else {
        console.log('✅ Puzzles table created');
      }
    });

    // Scores table
    db.run(`
      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        puzzle_id INTEGER NOT NULL,
        time_taken INTEGER NOT NULL,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (puzzle_id) REFERENCES puzzles(id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating scores table:', err);
      } else {
        console.log('✅ Scores table created');
      }
    });

    // Sprint results table
    db.run(`
      CREATE TABLE IF NOT EXISTS sprint_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL,
        user_id INTEGER,
        taps INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating sprint_results table:', err);
      } else {
        console.log('✅ Sprint results table created');
      }
    });

    // Insert default admin user
    const adminPassword = bcrypt.hashSync('admin123', 10);
    db.run(`
      INSERT OR IGNORE INTO users (username, email, password_hash, role) 
      VALUES ('admin', 'admin@sokoban.com', ?, 'admin')
    `, [adminPassword], (err) => {
      if (err) {
        console.error('Error inserting admin user:', err);
      } else {
        console.log('✅ Admin user created');
      }
    });

    // Clear any existing admin-created levels to reset to default state
    db.run('DELETE FROM puzzles', (err) => {
      if (err) {
        console.error('Error clearing existing puzzles:', err);
      } else {
        console.log('✅ Cleared existing admin-created levels');
      }
    });

    // Note: Default levels (1-4) are handled in the frontend
    // Only admin-created levels are stored in the database
  });
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(limiter);
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? 'https://yourdomain.com' : true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper function to promisify database queries
const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log('Auth middleware - Method:', req.method, 'Path:', req.path);
  console.log('Auth middleware - Auth header:', authHeader ? 'Present' : 'Missing');
  console.log('Auth middleware - Token:', token ? 'Present' : 'Missing');

  if (!token) {
    console.log('Auth middleware - No token provided');
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Auth middleware - Decoded token:', decoded);
    
    const user = await dbGet('SELECT id, username, email, role FROM users WHERE id = ?', [decoded.userId]);
    console.log('Auth middleware - User found:', user);
    
    if (!user) {
      console.log('Auth middleware - User not found');
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    console.log('Auth middleware - Authentication successful for user:', user.username, 'role:', user.role);
    next();
  } catch (error) {
    console.log('Auth middleware - Token verification failed:', error.message);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Routes
// Auth verify route
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ 
    message: 'Auth service is working',
    user: req.user
  });
});

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, role = 'player' } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Check if user already exists
    const existingUser = await dbGet('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await dbRun(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, email, passwordHash, role]
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: result.id, username, role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: result.id,
        username,
        email,
        role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find user
    const user = await dbGet('SELECT id, username, email, password_hash, role FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role
    }
  });
});

// Puzzle routes
app.get('/api/puzzles', async (req, res) => {
  try {
    const puzzles = await dbAll(`
      SELECT p.id, p.name, p.layout, p.created_at, u.username as created_by_username
      FROM puzzles p
      LEFT JOIN users u ON p.created_by = u.id
      ORDER BY p.id ASC
    `);

    res.json({ puzzles });
  } catch (error) {
    console.error('Error fetching puzzles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/puzzles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const puzzle = await dbGet(`
      SELECT p.id, p.name, p.layout, p.created_at, u.username as created_by_username
      FROM puzzles p
      LEFT JOIN users u ON p.created_by = u.id
      WHERE p.id = ?
    `, [id]);

    if (!puzzle) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    res.json({ puzzle });
  } catch (error) {
    console.error('Error fetching puzzle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new puzzle (admin only)
app.post('/api/puzzles', authenticateToken, async (req, res) => {
  try {
    const { name, layout } = req.body;

    if (!name || !layout) {
      return res.status(400).json({ error: 'Name and layout are required' });
    }

    // Validate JSON layout
    try {
      JSON.parse(layout);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid JSON format in layout' });
    }

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Create puzzle
    const result = await dbRun(
      'INSERT INTO puzzles (name, layout, created_by) VALUES (?, ?, ?)',
      [name, layout, req.user.userId]
    );

    res.status(201).json({
      message: 'Puzzle created successfully',
      puzzle: {
        id: result.id,
        name,
        layout,
        created_by: req.user.userId
      }
    });
  } catch (error) {
    console.error('Error creating puzzle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete puzzle (admin only)
app.delete('/api/puzzles/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Check if puzzle exists
    const puzzle = await dbGet('SELECT id FROM puzzles WHERE id = ?', [id]);
    if (!puzzle) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    // Delete puzzle
    await dbRun('DELETE FROM puzzles WHERE id = ?', [id]);

    res.json({ message: 'Puzzle deleted successfully' });
  } catch (error) {
    console.error('Error deleting puzzle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Score routes
app.post('/api/scores', authenticateToken, async (req, res) => {
  try {
    const { puzzleId, timeTaken } = req.body;

    if (!puzzleId || !timeTaken || timeTaken < 0) {
      return res.status(400).json({ error: 'Valid puzzle ID and time taken are required' });
    }

    // Check if puzzle exists
    const puzzle = await dbGet('SELECT id FROM puzzles WHERE id = ?', [puzzleId]);
    if (!puzzle) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    // Save score
    const result = await dbRun(
      'INSERT INTO scores (user_id, puzzle_id, time_taken) VALUES (?, ?, ?)',
      [req.user.id, puzzleId, timeTaken]
    );

    res.status(201).json({
      message: 'Score saved successfully',
      score: {
        id: result.id,
        user_id: req.user.id,
        puzzle_id: puzzleId,
        time_taken: timeTaken
      }
    });
  } catch (error) {
    console.error('Error saving score:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/scores/leaderboard', async (req, res) => {
  try {
    const leaderboard = await dbAll(`
      SELECT 
        u.username,
        u.role,
        COUNT(s.id) as puzzles_completed,
        SUM(s.time_taken) as total_time,
        AVG(s.time_taken) as average_time
      FROM users u
      LEFT JOIN scores s ON u.id = s.user_id
      WHERE u.role IN ('player', 'admin')
      GROUP BY u.id, u.username, u.role
      HAVING puzzles_completed > 0
      ORDER BY total_time ASC
      LIMIT 20
    `);

    res.json({ leaderboard });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/scores/leaderboard/:puzzleId', async (req, res) => {
  try {
    const { puzzleId } = req.params;

    // Check if puzzle exists
    const puzzle = await dbGet('SELECT id, name FROM puzzles WHERE id = ?', [puzzleId]);
    if (!puzzle) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    // Get leaderboard for this puzzle
    const leaderboard = await dbAll(`
      SELECT 
        s.time_taken,
        s.completed_at,
        u.username,
        u.role
      FROM scores s
      JOIN users u ON s.user_id = u.id
      WHERE s.puzzle_id = ?
      ORDER BY s.time_taken ASC
      LIMIT 10
    `, [puzzleId]);

    res.json({
      puzzle,
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching puzzle leaderboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: 'SQLite'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Sprint Game API Routes
app.post('/api/sprint/start', (req, res) => {
  try {
    const gameId = `sprint_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const gameState = {
      id: gameId,
      status: 'waiting', // waiting, countdown, active, finished
      players: new Map(),
      startTime: null,
      endTime: null,
      countdown: 5, // 5 second countdown
      gameDuration: 15000 // 15 seconds
    };
    
    sprintGames.set(gameId, gameState);
    
    res.json({ 
      success: true, 
      gameId: gameId,
      message: 'Sprint game created successfully' 
    });
  } catch (error) {
    console.error('Error creating sprint game:', error);
    res.status(500).json({ error: 'Failed to create sprint game' });
  }
});

app.get('/api/sprint/results/:gameId', (req, res) => {
  try {
    const { gameId } = req.params;
    
    db.all(
      'SELECT sr.*, u.username FROM sprint_results sr LEFT JOIN users u ON sr.user_id = u.id WHERE sr.game_id = ? ORDER BY sr.taps DESC',
      [gameId],
      (err, results) => {
        if (err) {
          console.error('Error fetching sprint results:', err);
          return res.status(500).json({ error: 'Failed to fetch results' });
        }
        
        res.json({ success: true, results });
      }
    );
  } catch (error) {
    console.error('Error fetching sprint results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Sprint Game Helper Functions
function startSprintCountdown(gameId) {
  const game = sprintGames.get(gameId);
  if (!game) return;
  
  game.status = 'countdown';
  game.countdown = 5;
  
  const countdownInterval = setInterval(() => {
    io.to(gameId).emit('countdown', { 
      seconds: game.countdown,
      status: 'countdown'
    });
    
    game.countdown--;
    
    if (game.countdown < 0) {
      clearInterval(countdownInterval);
      startSprintGame(gameId);
    }
  }, 1000);
}

function startSprintGame(gameId) {
  const game = sprintGames.get(gameId);
  if (!game) return;
  
  game.status = 'active';
  game.startTime = Date.now();
  game.endTime = game.startTime + game.gameDuration;
  
  io.to(gameId).emit('game-started', {
    status: 'active',
    duration: game.gameDuration
  });
  
  // End game after duration
  setTimeout(() => {
    endSprintGame(gameId);
  }, game.gameDuration);
}

function endSprintGame(gameId) {
  const game = sprintGames.get(gameId);
  if (!game) return;
  
  game.status = 'finished';
  
  // Save results to database
  const players = Array.from(game.players.values());
  players.forEach(player => {
    db.run(
      'INSERT INTO sprint_results (game_id, user_id, taps) VALUES (?, ?, ?)',
      [gameId, null, player.taps], // user_id is null for anonymous players
      (err) => {
        if (err) {
          console.error('Error saving sprint result:', err);
        }
      }
    );
  });
  
  // Sort players by taps (descending)
  const sortedPlayers = players.sort((a, b) => b.taps - a.taps);
  const winner = sortedPlayers[0];
  
  io.to(gameId).emit('game-ended', {
    status: 'finished',
    results: sortedPlayers,
    winner: winner
  });
  
  // Clean up game after 30 seconds
  setTimeout(() => {
    sprintGames.delete(gameId);
  }, 30000);
}

// Socket.IO handlers for Sprint Game
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('join-sprint', (data) => {
    try {
      const { gameId, username } = data;
      const game = sprintGames.get(gameId);
      
      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }
      
      if (game.status !== 'waiting' && game.status !== 'countdown') {
        socket.emit('error', { message: 'Game already started or finished' });
        return;
      }
      
      // Add player to game
      game.players.set(socket.id, {
        id: socket.id,
        username: username || `Player_${socket.id.substr(0, 6)}`,
        taps: 0,
        connected: true
      });
      
      activePlayers.set(socket.id, { gameId, username });
      socket.join(gameId);
      
      // Broadcast updated player list
      io.to(gameId).emit('players-updated', {
        players: Array.from(game.players.values()),
        gameStatus: game.status
      });
      
      console.log(`Player ${username} joined game ${gameId}`);
      
      // Auto-start game if this is the first player and we have at least 1 player
      if (game.players.size >= 1 && game.status === 'waiting') {
        startSprintCountdown(gameId);
      }
      
    } catch (error) {
      console.error('Error joining sprint game:', error);
      socket.emit('error', { message: 'Failed to join game' });
    }
  });
  
  socket.on('tap', (data) => {
    try {
      const { gameId } = data;
      const game = sprintGames.get(gameId);
      
      if (!game || game.status !== 'active') {
        return; // Ignore taps if game is not active
      }
      
      const player = game.players.get(socket.id);
      if (player) {
        player.taps++;
        
        // Broadcast updated tap count
        io.to(gameId).emit('tap-update', {
          playerId: socket.id,
          username: player.username,
          taps: player.taps
        });
      }
    } catch (error) {
      console.error('Error processing tap:', error);
    }
  });
  
  socket.on('disconnect', () => {
    try {
      const playerInfo = activePlayers.get(socket.id);
      if (playerInfo) {
        const { gameId } = playerInfo;
        const game = sprintGames.get(gameId);
        
        if (game) {
          game.players.delete(socket.id);
          activePlayers.delete(socket.id);
          
          // Broadcast updated player list
          io.to(gameId).emit('players-updated', {
            players: Array.from(game.players.values()),
            gameStatus: game.status
          });
        }
      }
      
      console.log(`Player disconnected: ${socket.id}`);
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Database: SQLite (sokoban.db)`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔌 WebSocket server ready for sprint games`);
  console.log(`\n📋 Default credentials:`);
  console.log(`   Admin: username=admin, password=admin123`);
  console.log(`\n🌐 Frontend: http://localhost:3000`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('✅ Database connection closed');
    }
    process.exit(0);
  });
});