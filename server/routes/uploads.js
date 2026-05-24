'use strict';

const express = require('express');
const path    = require('path');
const os      = require('os');
const fsp     = require('fs/promises');
const crypto  = require('crypto');
const { validateRepoName } = require('../lib/repoValidation');

const router   = express.Router();
const REPOS_DIR  = path.join(os.homedir(), 'repos');
const GLOBAL_DIR = path.join(os.homedir(), '.claude-mobile', 'uploads');
const MAX_BYTES  = 10 * 1024 * 1024; // 10 MB decoded

function sanitizeFilename(name) {
  return path.basename(name)
    .replace(/[^a-zA-Z0-9._\- ]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 200) || 'file';
}

// POST /api/uploads
// Body: { name: string, content: string (base64), repo?: string }
router.post('/', async (req, res) => {
  const { name, content, repo } = req.body;

  if (!name || typeof name !== 'string' || !content || typeof content !== 'string') {
    return res.status(400).json({ error: 'name e content sono obbligatori' });
  }

  if (repo !== undefined && repo !== null && repo !== '') {
    const v = validateRepoName(repo);
    if (!v.ok) return res.status(400).json({ error: v.error });
  }

  let buf;
  try {
    buf = Buffer.from(content, 'base64');
  } catch {
    return res.status(400).json({ error: 'Contenuto base64 non valido' });
  }

  if (buf.length > MAX_BYTES) {
    return res.status(413).json({ error: 'File troppo grande (max 10 MB)' });
  }

  const uid  = crypto.randomBytes(6).toString('hex');
  const safe = sanitizeFilename(name);
  const filename = `${uid}_${safe}`;

  const uploadDir = (repo)
    ? path.join(REPOS_DIR, repo, '.claude-uploads')
    : GLOBAL_DIR;

  await fsp.mkdir(uploadDir, { recursive: true, mode: 0o700 });

  const filePath = path.join(uploadDir, filename);

  // Path traversal guard
  if (!filePath.startsWith(uploadDir + path.sep) && filePath !== uploadDir) {
    return res.status(400).json({ error: 'Nome file non valido' });
  }

  await fsp.writeFile(filePath, buf, { mode: 0o600 });

  const relPath = repo ? `.claude-uploads/${filename}` : filePath;

  res.json({ ok: true, filePath, relPath, filename });
});

module.exports = router;
