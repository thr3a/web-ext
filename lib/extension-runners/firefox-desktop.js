/**
 * This module provide an ExtensionRunner subclass that manage an extension executed
 * in a Firefox for Desktop instance.
 */

import { MultiExtensionsReloadError, RemoteTempInstallNotSupported, WebExtError } from '../errors.js';
import { createLogger } from '../util/logger.js';
const log = createLogger(import.meta.url);

/**
 * Implements an IExtensionRunner which manages a Firefox Desktop instance.
 */
export class FirefoxDesktopExtensionRunner {
  cleanupCallbacks;
  params;
  profile;
  // Map extensions sourceDir to their related addon ids.
  reloadableExtensions;
  remoteFirefox;
  runningInfo;
  constructor(params) {
    this.params = params;
    this.reloadableExtensions = new Map();
    this.cleanupCallbacks = new Set();
  }

  // Method exported from the IExtensionRunner interface.

  /**
   * Returns the runner name.
   */
  getName() {
    return 'Firefox Desktop';
  }

  /**
   * Setup the Firefox Profile and run a Firefox Desktop instance.
   */
  async run() {
    // Get a firefox profile with the custom Prefs set (a new or a cloned one).
    // Pre-install extensions as proxy if needed (and disable auto-reload if you do)
    await this.setupProfileDir();

    // (if reload is enabled):
    // - Connect to the firefox instance on RDP
    // - Install any extension if needed (if not installed as proxy)
    // - Keep track of the extension id assigned in a map with the sourceDir as a key
    await this.startFirefoxInstance();
  }

  /**
   * Reloads all the extensions, collect any reload error and resolves to
   * an array composed by a single ExtensionRunnerReloadResult object.
   */
  async reloadAllExtensions() {
    const runnerName = this.getName();
    const reloadErrors = new Map();
    for (const {
      sourceDir
    } of this.params.extensions) {
      const [res] = await this.reloadExtensionBySourceDir(sourceDir);
      if (res.reloadError instanceof Error) {
        reloadErrors.set(sourceDir, res.reloadError);
      }
    }
    if (reloadErrors.size > 0) {
      return [{
        runnerName,
        reloadError: new MultiExtensionsReloadError(reloadErrors)
      }];
    }
    return [{
      runnerName
    }];
  }

  /**
   * Reloads a single extension, collect any reload error and resolves to
   * an array composed by a single ExtensionRunnerReloadResult object.
   */
  async reloadExtensionBySourceDir(extensionSourceDir) {
    const runnerName = this.getName();
    const addonId = this.reloadableExtensions.get(extensionSourceDir);
    if (!addonId) {
      return [{
        sourceDir: extensionSourceDir,
        reloadError: new WebExtError('Extension not reloadable: ' + `no addonId has been mapped to "${extensionSourceDir}"`),
        runnerName
      }];
    }
    try {
      await this.remoteFirefox.reloadAddon(addonId);
    } catch (error) {
      return [{
        sourceDir: extensionSourceDir,
        reloadError: error,
        runnerName
      }];
    }
    return [{
      runnerName,
      sourceDir: extensionSourceDir
    }];
  }

  /**
   * Register a callback to be called when the runner has been exited
   * (e.g. the Firefox instance exits or the user has requested web-ext
   * to exit).
   */
  registerCleanup(fn) {
    this.cleanupCallbacks.add(fn);
  }

  /**
   * Exits the runner, by closing the managed Firefox instance.
   */
  async exit() {
    if (!this.runningInfo || !this.runningInfo.firefox) {
      throw new WebExtError('No firefox instance is currently running');
    }
    this.runningInfo.firefox.kill();
  }

  // Private helper methods.

  async setupProfileDir() {
    const {
      customPrefs,
      extensions,
      keepProfileChanges,
      preInstall,
      profilePath,
      firefoxApp
    } = this.params;
    if (profilePath) {
      if (keepProfileChanges) {
        log.debug(`Using Firefox profile from ${profilePath}`);
        this.profile = await firefoxApp.useProfile(profilePath, {
          customPrefs
        });
      } else {
        log.debug(`Copying Firefox profile from ${profilePath}`);
        this.profile = await firefoxApp.copyProfile(profilePath, {
          customPrefs
        });
      }
    } else {
      log.debug('Creating new Firefox profile');
      this.profile = await firefoxApp.createProfile({
        customPrefs
      });
    }

    // preInstall the extensions if needed.
    if (preInstall) {
      for (const extension of extensions) {
        await firefoxApp.installExtension({
          asProxy: true,
          extensionPath: extension.sourceDir,
          manifestData: extension.manifestData,
          profile: this.profile
        });
      }
    }
  }
  async startFirefoxInstance() {
    const {
      browserConsole,
      devtools,
      extensions,
      firefoxBinary,
      preInstall,
      startUrl,
      firefoxApp,
      firefoxClient,
      args
    } = this.params;
    const binaryArgs = [];
    if (browserConsole) {
      binaryArgs.push('-jsconsole');
    }
    if (startUrl) {
      const urls = Array.isArray(startUrl) ? startUrl : [startUrl];
      for (const url of urls) {
        binaryArgs.push('--url', url);
      }
    }
    if (args) {
      binaryArgs.push(...args);
    }
    this.runningInfo = await firefoxApp.run(this.profile, {
      firefoxBinary,
      binaryArgs,
      extensions,
      devtools
    });
    this.runningInfo.firefox.on('close', () => {
      for (const cleanupCb of this.cleanupCallbacks) {
        try {
          cleanupCb();
        } catch (error) {
          log.error(`Exception on executing cleanup callback: ${error}`);
        }
      }
    });
    if (!preInstall) {
      const remoteFirefox = this.remoteFirefox = await firefoxClient({
        port: this.runningInfo.debuggerPort
      });

      // Install all the temporary addons.
      for (const extension of extensions) {
        try {
          const addonId = await remoteFirefox.installTemporaryAddon(extension.sourceDir, devtools).then(installResult => {
            return installResult.addon.id;
          });
          if (!addonId) {
            throw new WebExtError('Unexpected missing addonId in the installAsTemporaryAddon result');
          }
          this.reloadableExtensions.set(extension.sourceDir, addonId);
        } catch (error) {
          if (error instanceof RemoteTempInstallNotSupported) {
            log.debug(`Caught: ${String(error)}`);
            throw new WebExtError('Temporary add-on installation is not supported in this version' + ' of Firefox (you need Firefox 49 or higher). For older Firefox' + ' versions, use --pre-install');
          } else {
            throw error;
          }
        }
      }
    }
  }
}
//# sourceMappingURL=firefox-desktop.js.map