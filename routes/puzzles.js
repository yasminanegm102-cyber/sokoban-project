const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all puzzles
router.get('/', async (req, res) => {
  try {
    const [puzzles] = await pool.execute(`
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

// Get specific puzzle by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [puzzles] = await pool.execute(`
      SELECT p.id, p.name, p.layout, p.created_at, u.username as created_by_username
      FROM puzzles p
      LEFT JOIN users u ON p.created_by = u.id
      WHERE p.id = ?
    `, [id]);

    if (puzzles.length === 0) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    res.json({ puzzle: puzzles[0] });
  } catch (error) {
    console.error('Error fetching puzzle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new puzzle (admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, layout } = req.body;

    // Validate input
    if (!name || !layout) {
      return res.status(400).json({ error: 'Name and layout are required' });
    }

    // Validate layout structure
    if (!layout.width || !layout.height || !layout.grid || !layout.targets) {
      return res.status(400).json({ error: 'Invalid layout structure' });
    }

    // Create puzzle
    const [result] = await pool.execute(
      'INSERT INTO puzzles (name, layout, created_by) VALUES (?, ?, ?)',
      [name, JSON.stringify(layout), req.user.id]
    );

    res.status(201).json({
      message: 'Puzzle created successfully',
      puzzle: {
        id: result.insertId,
        name,
        layout,
        created_by: req.user.id
      }
    });
  } catch (error) {
    console.error('Error creating puzzle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update puzzle (admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, layout } = req.body;

    // Validate input
    if (!name || !layout) {
      return res.status(400).json({ error: 'Name and layout are required' });
    }

    // Check if puzzle exists
    const [existingPuzzles] = await pool.execute(
      'SELECT id FROM puzzles WHERE id = ?',
      [id]
    );

    if (existingPuzzles.length === 0) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    // Update puzzle
    await pool.execute(
      'UPDATE puzzles SET name = ?, layout = ? WHERE id = ?',
      [name, JSON.stringify(layout), id]
    );

    res.json({ message: 'Puzzle updated successfully' });
  } catch (error) {
    console.error('Error updating puzzle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete puzzle (admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if puzzle exists
    const [existingPuzzles] = await pool.execute(
      'SELECT id FROM puzzles WHERE id = ?',
      [id]
    );

    if (existingPuzzles.length === 0) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    // Delete puzzle
    await pool.execute('DELETE FROM puzzles WHERE id = ?', [id]);

    res.json({ message: 'Puzzle deleted successfully' });
  } catch (error) {
    console.error('Error deleting puzzle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
