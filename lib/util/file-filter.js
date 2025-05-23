import path from 'path';
import multimatch from 'multimatch';
import { createLogger } from './logger.js';
const log = createLogger(import.meta.url);

// check if target is a sub directory of src
export const isSubPath = (src, target) => {
  const relate = path.relative(src, target);
  // same dir
  if (!relate) {
    return false;
  }
  if (relate === '..') {
    return false;
  }
  return !relate.startsWith(`..${path.sep}`);
};

// FileFilter types and implementation.

/*
 * Allows or ignores files.
 */
export class FileFilter {
  filesToIgnore;
  sourceDir;
  constructor({
    baseIgnoredPatterns = ['**/*.xpi', '**/*.zip', '**/.*',
    // any hidden file and folder
    '**/.*/**/*',
    // and the content inside hidden folder
    '**/node_modules', '**/node_modules/**/*'],
    ignoreFiles = [],
    sourceDir,
    artifactsDir
  } = {}) {
    sourceDir = path.resolve(sourceDir);
    this.filesToIgnore = [];
    this.sourceDir = sourceDir;
    this.addToIgnoreList(baseIgnoredPatterns);
    if (ignoreFiles) {
      this.addToIgnoreList(ignoreFiles);
    }
    if (artifactsDir && isSubPath(sourceDir, artifactsDir)) {
      artifactsDir = path.resolve(artifactsDir);
      log.debug(`Ignoring artifacts directory "${artifactsDir}" ` + 'and all its subdirectories');
      this.addToIgnoreList([artifactsDir, path.join(artifactsDir, '**', '*')]);
    }
  }

  /**
   *  Resolve relative path to absolute path with sourceDir.
   */
  resolveWithSourceDir(file) {
    const resolvedPath = path.resolve(this.sourceDir, file);
    log.debug(`Resolved path ${file} with sourceDir ${this.sourceDir} ` + `to ${resolvedPath}`);
    return resolvedPath;
  }

  /**
   *  Insert more files into filesToIgnore array.
   */
  addToIgnoreList(files) {
    for (const file of files) {
      if (file.charAt(0) === '!') {
        const resolvedFile = this.resolveWithSourceDir(file.substr(1));
        this.filesToIgnore.push(`!${resolvedFile}`);
      } else {
        this.filesToIgnore.push(this.resolveWithSourceDir(file));
      }
    }
  }

  /*
   * Returns true if the file is wanted.
   *
   * If filePath does not start with a slash, it will be treated as a path
   * relative to sourceDir when matching it against all configured
   * ignore-patterns.
   *
   * Example: this is called by zipdir as wantFile(filePath) for each
   * file in the folder that is being archived.
   */
  wantFile(filePath) {
    const resolvedPath = this.resolveWithSourceDir(filePath);
    const matches = multimatch(resolvedPath, this.filesToIgnore);
    if (matches.length > 0) {
      log.debug(`FileFilter: ignoring file ${resolvedPath}`);
      return false;
    }
    return true;
  }
}

// a helper function to make mocking easier

export const createFileFilter = params => new FileFilter(params);
//# sourceMappingURL=file-filter.js.map