// Archive folder layout and collision-free file naming.
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/connection.cjs');
const { getArchiveRoot } = require('./archivePaths.cjs');
const { resolveArchiveRoot } = require('../security/archiveRoot.cjs');

// Fixed archive layout (matches the office's physical structure):
//   <ArchiveRoot>/<ProgramFolder>/<Letter>/<LASTNAME, Firstname M. (SY)>/
// See item 2 of the spec. Program folder names are provisional pending
// client confirmation; the PDF only documents "College Student Records".
const PROGRAM_FOLDERS = {
  College: 'College Student Records',
  'Graduate School': 'Graduate Student Records',
  Medicine: 'Medical Student Records',
  Law: 'Law Student Records'
};

function sanitizeFolderName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '-').trim();
}

function buildStudentFolderName(student) {
  const lastName = student.last_name.trim();
  const firstName = student.first_name.trim();
  const middleInitial = student.middle_name && student.middle_name.trim()
    ? ` ${student.middle_name.trim()[0].toUpperCase()}.`
    : '';
  return sanitizeFolderName(`${lastName.toUpperCase()}, ${firstName}${middleInitial} (${student.school_year})`);
}

// Shared by folders:generatePath (renderer-supplied root) and
// documents:update (configured root). Resolves the destination
// document-type folder for a document, creating it, and returns
// { ok: true, folderPath, studentDir? } or { ok: false, error }.
function computeDocumentTypeFolder({ studentId, documentTypeName, archiveRoot }) {
  const root = resolveArchiveRoot(archiveRoot, null) || getArchiveRoot();
  const sanitizedType = sanitizeFolderName(documentTypeName || 'Uncategorized') || 'Uncategorized';

  // General document (no student): <Root>/General Documents/<DocumentTypeName>/
  if (!studentId) {
    const folderPath = path.join(root, 'General Documents', sanitizedType);
    fs.mkdirSync(folderPath, { recursive: true });
    return { ok: true, folderPath };
  }

  const student = getDb().prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) {
    return { ok: false, error: 'Student not found.' };
  }
  if (!student.program_level) {
    return { ok: false, error: `${student.first_name} ${student.last_name} has no Program Level set. Edit the student record first.` };
  }
  if (!student.school_year) {
    return { ok: false, error: `${student.first_name} ${student.last_name} has no School Year set. Edit the student record first.` };
  }

  const programFolder = PROGRAM_FOLDERS[student.program_level];
  if (!programFolder) {
    return { ok: false, error: `Unknown program level: ${student.program_level}` };
  }

  const letter = (student.last_name.trim()[0] || '#').toUpperCase();
  const studentDir = path.join(root, programFolder, letter, buildStudentFolderName(student));

  // Every document type gets its own folder inside the student directory:
  //   <StudentDir>/<DocumentTypeName>/<file>
  const folderPath = path.join(studentDir, sanitizedType);
  fs.mkdirSync(folderPath, { recursive: true });
  return { ok: true, folderPath, studentDir };
}

// Generate a Windows-safe filename following the pattern:
// LASTNAME, FIRSTNAME_DOCUMENT_TYPE_(COUNTER)
// For student documents only. General documents use plain document type name.
function buildStudentDocumentFileName(student, documentTypeName, ext, counter) {
  // Normalize names and document type to uppercase
  const lastName = student.last_name.trim().toUpperCase();
  const firstName = student.first_name.trim().toUpperCase();
  // Replace spaces in document type with underscores
  const docType = documentTypeName.trim().toUpperCase().replace(/\s+/g, '_');
  
  // Clean extension
  const cleanExt = String(ext || 'jpg').replace(/[^a-zA-Z0-9]/g, '');
  
  // Build base name
  const baseName = `${lastName}, ${firstName}_${docType}`;
  
  // Add counter
  const finalName = `${baseName}_(${counter}).${cleanExt}`;
  
  // Sanitize for Windows (remove invalid chars, trim trailing spaces/periods)
  return sanitizeWindowsFileName(finalName);
}

// Sanitize filename for Windows filesystem restrictions
function sanitizeWindowsFileName(name) {
  // Replace invalid Windows filename characters with dash
  let cleaned = name.replace(/[\\/:*?"<>|]/g, '-');
  // Remove control characters
  cleaned = cleaned.replace(/[\x00-\x1f\x80-\x9f]/g, '');
  // Remove trailing spaces and periods (Windows doesn't allow these)
  cleaned = cleaned.replace(/[\s.]+$/, '');
  // Ensure filename is not empty
  if (!cleaned || cleaned.trim().length === 0) {
    cleaned = 'document';
  }
  // Check for reserved Windows names
  const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  const nameWithoutExt = cleaned.split('.')[0].toUpperCase();
  if (reservedNames.includes(nameWithoutExt)) {
    cleaned = `_${cleaned}`;
  }
  // Limit total path length (Windows MAX_PATH is 260, leave room for directory path)
  if (cleaned.length > 200) {
    const parts = cleaned.split('.');
    const ext = parts.pop();
    const base = parts.join('.').substring(0, 195);
    cleaned = `${base}.${ext}`;
  }
  return cleaned;
}

// First candidate is the plain base name, then "(n)" suffixes. Scanning the
// filesystem (not the database) skips files left by older versions whose
// numbering started at "(2)", so names can never collide. startAt preserves
// generatePath's numbering after a legacy-file promotion (plain name taken,
// so the next candidate is "(2)").
function pickCollisionFreeFileName(folderPath, baseName, ext, startAt = 0) {
  const cleanExt = String(ext || 'dat').replace(/[^a-zA-Z0-9]/g, '');
  let n = startAt;
  for (;;) {
    const candidate = n === 0
      ? `${baseName}.${cleanExt}`
      : `${baseName} (${n}).${cleanExt}`;
    if (!fs.existsSync(path.join(folderPath, candidate))) {
      return candidate;
    }
    n++;
  }
}

module.exports = { PROGRAM_FOLDERS, sanitizeFolderName, buildStudentFolderName, buildStudentDocumentFileName, sanitizeWindowsFileName, pickCollisionFreeFileName, computeDocumentTypeFolder };
