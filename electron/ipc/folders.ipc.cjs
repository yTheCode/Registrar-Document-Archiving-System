// folders:generatePath (moved verbatim from main.cjs in phase 1b).
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/connection.cjs');
const { computeDocumentTypeFolder, buildStudentDocumentFileName, pickCollisionFreeFileName } = require('../services/folderNaming.cjs');


// ==================== FOLDER PATH GENERATION ====================

ipcMain.handle('folders:generatePath', async (event, { studentId, documentTypeId, documentTypeName, archiveRoot, ext }) => {
  try {
    const folderResult = computeDocumentTypeFolder({ studentId, documentTypeName, archiveRoot });
    if (!folderResult.ok) {
      return { success: false, error: folderResult.error };
    }
    const typeFolder = folderResult.folderPath;

    // General document (no student): the type folder is the destination.
    if (!studentId) {
      const fileName = pickCollisionFreeFileName(typeFolder, documentTypeName, ext);
      return { success: true, folderPath: typeFolder, fileName, destPath: path.join(typeFolder, fileName) };
    }

    // Get student info for filename generation
    const student = getDb().prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    if (!student) {
      return { success: false, error: 'Student not found.' };
    }

    // Find next counter for this student and document type
    // Check existing files in the folder to determine next counter
    const existingFiles = fs.readdirSync(typeFolder);
    const lastName = student.last_name.trim().toUpperCase();
    const firstName = student.first_name.trim().toUpperCase();
    const docType = documentTypeName.trim().toUpperCase().replace(/\s+/g, '_');
    const basePattern = `${lastName}, ${firstName}_${docType}_`;
    
    let maxCounter = 0;
    for (const fileName of existingFiles) {
      if (fileName.startsWith(basePattern)) {
        // Extract counter from filename like "NAME_TYPE_(1).ext" or "NAME_TYPE_(2).ext"
        const match = fileName.match(/_\((\d+)\)\.[^.]+$/);
        if (match) {
          const counter = parseInt(match[1], 10);
          if (counter > maxCounter) {
            maxCounter = counter;
          }
        }
      }
    }

    const nextCounter = maxCounter + 1;
    const fileName = buildStudentDocumentFileName(student, documentTypeName, ext, nextCounter);

    return { success: true, folderPath: folderResult.studentDir, fileName, destPath: path.join(typeFolder, fileName) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
