'use strict';

const fsp  = require('fs/promises');
const path = require('path');
const simpleGit = require('simple-git');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_DIFF_LENGTH = 100_000;
const UNTRACKED_CONTENT_LIMIT = 2_000;

/**
 * Builds a unified diff string for the given repo (staged + unstaged + untracked).
 * @param {string} repoPath  absolute realpath of the repo
 * @returns {Promise<string>}
 */
async function getRepoDiff(repoPath) {
  const git = simpleGit(repoPath);
  let diffText = '';

  try {
    diffText = await git.diff(['HEAD']);
  } catch {
    // HEAD may not exist on a brand-new repo with no commits
    try { diffText = await git.diff([]); } catch {}
  }

  // Append untracked file contents as synthetic diff chunks
  let untracked = [];
  try {
    const st = await git.status();
    untracked = st.not_added || [];
  } catch {}

  const untrackedChunks = [];
  for (const relPath of untracked) {
    const fullPath = path.join(repoPath, relPath);
    try {
      let content = await fsp.readFile(fullPath, 'utf8');
      if (content.length > UNTRACKED_CONTENT_LIMIT) {
        content = content.slice(0, UNTRACKED_CONTENT_LIMIT) + '\n...[truncated]';
      }
      untrackedChunks.push(`--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1 @@\n${content}`);
    } catch {
      untrackedChunks.push(`--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1 @@\n[Binary or unreadable file]`);
    }
  }

  if (untrackedChunks.length > 0) {
    diffText += '\n\n' + untrackedChunks.join('\n\n');
  }

  if (diffText.length > MAX_DIFF_LENGTH) {
    diffText = diffText.slice(0, MAX_DIFF_LENGTH) + `\n\n[Diff truncated to ${MAX_DIFF_LENGTH} characters]`;
  }

  return diffText.trim();
}

/**
 * Calls the Gemini REST API to generate a conventional commit message.
 * @param {string} diffText
 * @param {string} apiKey    Gemini API key
 * @param {string} [model]   Gemini model ID
 * @returns {Promise<{ title: string, body: string }>}
 */
async function generateCommitMessage(diffText, apiKey, model = 'gemini-3.5-flash') {
  if (!apiKey) throw new Error('Gemini API key not configured');
  if (!diffText) return { title: 'Update files', body: 'No differences found.' };

  const systemInstruction = `You are an expert developer. Your task is to write a clean, conventional commit message based on a git diff.
The output MUST be a valid JSON object with:
- "title": short, imperative commit title (max 60 chars).
- "body": detailed description of changes and why.

Requirements:
- Language: English.
- Use conventional commits (feat, fix, chore, style, refactor, docs, build, ci).
- No markdown formatting in the response.`;

  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method:  'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Api-Revision': '2026-05-20'
    },
    body:    JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [{ text: `Git Diff:\n${diffText}` }] }],
      generationConfig: { 
        thinkingConfig: {
          thinkingLevel: 'LOW'
        },
        response_format: {
          type: 'text',
          response_mime_type: 'application/json',
          response_schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body: { type: 'string' }
            },
            required: ['title', 'body']
          }
        }
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const msg = errBody.error?.message ?? `Gemini API error: HTTP ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();

  try {
    const parsed = JSON.parse(text);
    return {
      title: parsed.title || 'Update files',
      body:  parsed.body  || '',
    };
  } catch {
    return { title: 'Update files via AI', body: text };
  }
}

module.exports = { getRepoDiff, generateCommitMessage };
