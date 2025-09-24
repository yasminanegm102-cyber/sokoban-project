const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requirePlayer } = require('../middleware/auth');

const router = express.Router();

// Save user score
router.post('/', authenticateToken, requirePlayer, async (req, res) => {
  try {
    const { puzzleId, timeTaken } = req.body;

    // Validate input
    if (!puzzleId || !timeTaken || timeTaken < 0) {
      return res.status(400).json({ error: 'Valid puzzle ID and time taken are required' });
    }

    // Check if puzzle exists
    const [puzzles] = await pool.execute(
      'SELECT id FROM puzzles WHERE id = ?',
      [puzzleId]
    );

    if (puzzles.length === 0) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    // Save score
    const [result] = await pool.execute(
      'INSERT INTO scores (user_id, puzzle_id, time_taken) VALUES (?, ?, ?)',
      [req.user.id, puzzleId, timeTaken]
    );

    res.status(201).json({
      message: 'Score saved successfully',
      score: {
        id: result.insertId,
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

// Get leaderboard for a specific puzzle
router.get('/leaderboard/:puzzleId', async (req, res) => {
  try {
    const { puzzleId } = req.params;

    // Check if puzzle exists
    const [puzzles] = await pool.execute(
      'SELECT id, name FROM puzzles WHERE id = ?',
      [puzzleId]
    );

    if (puzzles.length === 0) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    // Get leaderboard (top 10 players by fastest time)
    const [scores] = await pool.execute(`
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
      puzzle: puzzles[0],
      leaderboard: scores
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's best scores for all puzzles
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user's best score for each puzzle
    const [scores] = await pool.execute(`
      SELECT 
        s.puzzle_id,
        p.name as puzzle_name,
        MIN(s.time_taken) as best_time,
        s.completed_at
      FROM scores s
      JOIN puzzles p ON s.puzzle_id = p.id
      WHERE s.user_id = ?
      GROUP BY s.puzzle_id, p.name
      ORDER BY s.puzzle_id ASC
    `, [userId]);

    res.json({ scores });
  } catch (error) {
    console.error('Error fetching user scores:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get overall leaderboard (all puzzles combined)
router.get('/leaderboard', async (req, res) => {
  try {
    // Get top players by total completion time across all puzzles
    const [leaderboard] = await pool.execute(`
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
    console.error('Error fetching overall leaderboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
