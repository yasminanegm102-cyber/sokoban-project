# Sokoban Multi-User Game Platform

A comprehensive Sokoban puzzle game platform with multi-user support, admin dashboard, and real-time multiplayer sprint game functionality.

## 🎮 Features

### Core Game Features
- **Sokoban Puzzle Game**: Classic box-pushing puzzle with 4 default levels
- **Real-time Timer**: Tracks completion time for each level
- **Win Condition**: Proper Sokoban logic - player wins only when all boxes are on targets
- **Visual Feedback**: Different colors for boxes/players on goals
- **Keyboard Controls**: Arrow keys for movement

### User Management
- **Role-based Access**: Anonymous, Player, and Admin roles
- **JWT Authentication**: Secure login/registration system
- **User Profiles**: Track scores and completion times

### Admin Features
- **Puzzle Creation**: Create custom Sokoban levels via JSON
- **Level Management**: View, create, and delete custom levels
- **Dashboard**: Comprehensive admin interface

### Multiplayer Features
- **Sprint Game**: 15-second tap competition with WebSocket synchronization
- **Real-time Updates**: Live leaderboards and game state

### Leaderboard System
- **Per-level Rankings**: Individual leaderboards for each level
- **Real-time Updates**: Automatically refreshes when players complete levels
- **Score Tracking**: Fastest completion times with medals (🥇🥈🥉)

## 🛠️ Technology Stack

### Frontend
- **HTML5/CSS3/JavaScript**: Pure vanilla implementation
- **Real-time UI**: Dynamic updates and notifications

### Backend
- **Node.js/Express**: RESTful API server
- **Socket.IO**: Real-time WebSocket communication
- **SQLite**: Lightweight database for data persistence
- **JWT**: Secure authentication tokens

### Database Schema
```sql
-- Users table
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'player',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Puzzles table
CREATE TABLE puzzles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  layout TEXT NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Scores table
CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  puzzle_id INTEGER NOT NULL,
  time_taken INTEGER NOT NULL,
  completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sprint results table
CREATE TABLE sprint_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  user_id INTEGER,
  taps INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 🚀 Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Installation Steps

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd sokoban-game
   ```

2. **Install dependencies**
   ```bash
   cd server
   npm install
   ```

3. **Environment setup**
   ```bash
   # Create config.env file in server directory
   echo "JWT_SECRET=your-super-secret-jwt-key-here" > server/config.env
   ```

4. **Start the server**
   ```bash
   cd server
   node index.js
   ```

5. **Access the game**
   - Open `index.html` in your browser
   - Admin dashboard: `admin.html`
   - Server runs on `http://localhost:5000`

### Default Credentials
- **Admin**: username=`admin`, password=`admin123`

## 🎯 Game Rules

### Sokoban Game
1. Use arrow keys to move the player (🧑)
2. Push boxes (📦) onto goals (🎯)
3. Complete all goals to win the level
4. Timer starts when level loads and stops when you win

### Sprint Game
1. Click "⚡ Sprint Game" to join
2. Wait for countdown to finish
3. Tap spacebar or click "Tap!" button as fast as possible
4. Player with most taps in 15 seconds wins

## 📁 Project Structure

```
sokoban-game/
├── index.html              # Main game interface
├── admin.html              # Admin dashboard
├── server/
│   ├── index.js           # Express server with Socket.IO
│   ├── config.env         # Environment variables
│   ├── sokoban.db         # SQLite database
│   └── package.json       # Dependencies
├── README.md              # This file
└── Prompt.md              # Development prompts used
```

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/verify` - Verify authentication

### Puzzles
- `GET /api/puzzles` - Get all puzzles
- `POST /api/puzzles` - Create new puzzle (admin only)
- `DELETE /api/puzzles/:id` - Delete puzzle (admin only)

### Scores
- `POST /api/scores` - Save completion score
- `GET /api/scores/leaderboard/:puzzleId` - Get level leaderboard

### Sprint Game
- `POST /api/sprint/start` - Start new sprint game
- `GET /api/sprint/results/:gameId` - Get sprint results

## 🎨 Customization

### Creating Custom Levels
Use the admin dashboard to create new Sokoban levels:

```json
{
  "width": 8,
  "height": 6,
  "grid": [
    ["#", "#", "#", "#", "#", "#", "#", "#"],
    ["#", " ", " ", " ", " ", " ", " ", "#"],
    ["#", " ", "P", "B", "B", " ", " ", "#"],
    ["#", " ", " ", " ", " ", " ", ".", "#"],
    ["#", " ", ".", " ", " ", " ", " ", "#"],
    ["#", "#", "#", "#", "#", "#", "#", "#"]
  ],
  "targets": [[2, 4], [3, 4]]
}
```

**Symbols:**
- `#` = Wall
- `P` = Player
- `B` = Box
- `.` = Target
- ` ` (space) = Empty

## 🐛 Challenges Faced & Solutions

### 1. **CORS Issues with File Protocol**
**Challenge**: Opening `index.html` directly via `file://` protocol caused CORS errors when making API calls.

**Solution**: 
- Updated all fetch calls to use full `http://localhost:5000` URLs
- Modified server CORS configuration to allow `origin: true` in development
- Added proper error handling for network requests

### 2. **Sokoban Win Condition Logic**
**Challenge**: Initial implementation allowed player to win by standing on targets instead of requiring boxes on targets.

**Solution**:
- Implemented proper target tracking system with `gameState.targets` array
- Modified win condition to check if ALL targets have boxes on them
- Added visual feedback for boxes/players on goals with different colors

### 3. **Real-time Leaderboard Updates**
**Challenge**: Leaderboard wasn't updating when players completed levels.

**Solution**:
- Implemented automatic leaderboard refresh after score saving
- Added notification system for user feedback
- Created global `updateLeaderboard()` function for real-time updates

### 4. **Admin Level Creation & Visibility**
**Challenge**: Admin-created levels weren't appearing for players due to JSON parsing issues.

**Solution**:
- Added robust JSON parsing with error handling
- Implemented proper level merging between default and admin-created levels
- Added debug logging for troubleshooting level loading

### 5. **Database Connection & Setup**
**Challenge**: SQLite database setup and connection management.

**Solution**:
- Implemented proper database initialization with table creation
- Added connection error handling and retry logic
- Created database helper functions for async operations

### 6. **WebSocket Integration for Sprint Game**
**Challenge**: Implementing real-time multiplayer functionality with synchronized countdown.

**Solution**:
- Integrated Socket.IO with Express server
- Implemented game room management and player tracking
- Added synchronized countdown and result broadcasting

## 🔄 Development Methodology

### 1. **Iterative Development**
- Started with basic Sokoban game functionality
- Added user authentication and role management
- Implemented admin dashboard and level creation
- Added multiplayer sprint game feature
- Enhanced with real-time updates and notifications

### 2. **User-Centric Design**
- Prioritized user experience with clear visual feedback
- Implemented proper error handling and notifications
- Added responsive design for different screen sizes
- Created intuitive navigation and controls

### 3. **Security-First Approach**
- Implemented JWT-based authentication
- Added role-based access control
- Sanitized user inputs and validated data
- Protected admin-only endpoints

### 4. **Performance Optimization**
- Used efficient database queries with proper indexing
- Implemented client-side caching for level data
- Added debouncing for real-time updates
- Optimized WebSocket connections

### 5. **Testing & Debugging**
- Added comprehensive console logging
- Implemented error boundaries and fallbacks
- Created debug functions for troubleshooting
