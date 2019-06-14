import { __ } from 'embark-i18n';
import { joinPath, canonicalHost, buildUrlFromConfig } from 'embark-utils';
import { ProcessLauncher } from 'embark-core';
const shellJs = require('shelljs');
const constants = require('embark-core/constants');
const cloneDeep = require('lodash.clonedeep');

let References = {
  ipfs: 'https://ipfs.io/docs/install/',
  swarm: 'http://swarm-guide.readthedocs.io/en/latest/installation.html'
};

class StorageProcessesLauncher {
  constructor(options) {
    this.logger = options.logger;
    this.logger.info("=== StorageProcessesLauncher")
    this.events = options.events;
    this.storageConfig = options.storageConfig;
    this.webServerConfig = options.webServerConfig;
    this.blockchainConfig = options.blockchainConfig;
    this.embark = options.embark;
    this.processes = {};
    this.corsParts = options.corsParts || [];
    this.restartCalled = false;
    this.manualExit = false;

    this.cors = this.buildCors();

    this.events.on('exit', () => {
      Object.keys(this.processes).forEach(processName => {
        this.processes[processName].send('exit');
      });
    });
  }

  buildCors() {
    let corsParts = cloneDeep(this.corsParts);
    // add our webserver CORS
    if (this.webServerConfig.enabled) {
      if (this.webServerConfig && this.webServerConfig.host) {
        corsParts.push(buildUrlFromConfig(this.webServerConfig));
      }
      else corsParts.push('http://localhost:8000');
    }

    // add all dapp connection storage
    if (this.storageConfig.enabled) {
      this.storageConfig.dappConnection.forEach(dappConn => {
        if (dappConn.getUrl || dappConn.host) {

          // if getUrl is specified in the config, that needs to be included in cors
          // instead of the concatenated protocol://host:port
          if (dappConn.getUrl) {
            // remove /ipfs or /bzz: from getUrl if it's there
            let getUrlParts = dappConn.getUrl.split('/');
            getUrlParts = getUrlParts.slice(0, 3);
            let host = canonicalHost(getUrlParts[2].split(':')[0]);
            let port = getUrlParts[2].split(':')[1];
            getUrlParts[2] = port ? [host, port].join(':') : host;
            corsParts.push(getUrlParts.join('/'));
          }
          // in case getUrl wasn't specified, use a built url
          else {
            corsParts.push(buildUrlFromConfig(dappConn));
          }
        }
      });
    }

    if (this.blockchainConfig.enabled) {
      // add our rpc endpoints to CORS
      if (this.blockchainConfig.rpcHost && this.blockchainConfig.rpcPort) {
        corsParts.push(`http://${canonicalHost(this.blockchainConfig.rpcHost)}:${this.blockchainConfig.rpcPort}`);
      }

      // add our ws endpoints to CORS
      if (this.blockchainConfig.wsRPC && this.blockchainConfig.wsHost && this.blockchainConfig.wsPort) {
        corsParts.push(`ws://${canonicalHost(this.blockchainConfig.wsHost)}:${this.blockchainConfig.wsPort}`);
      }
    }
    return corsParts;
  }

  processExited(storageName, code) {
    if (this.manualExit) {
      this.manualExit = false;
      return;
    }
    if (this.restartCalled) {
      this.restartCalled = false;
      return this.launchProcess(storageName, () => { });
    }
    this.logger.error(__(`Storage process for {{storageName}} ended before the end of this process. Code: {{code}}`, { storageName, code }));
  }

  launchProcess(storageName, callback) {
    const self = this;
    callback = callback || function () { };

    if (self.processes[storageName]) {
      return callback(__('Storage process already started'));
    }
    const filePath = joinPath(__dirname, `../${storageName}/process.js`);
    console.dir("==== filePath")
    console.dir(filePath)
    this.embark.fs.access(filePath, (err) => {
      if (err) {
        return callback(__('No process file for this storage type (%s) exists. Please start the process locally.', storageName));
      }

      let cmd = (storageName === 'swarm' ? (self.storageConfig.swarmPath || 'swarm') : 'ipfs');

      const program = shellJs.which(cmd);
      if (!program) {
        self.logger.warn(__('{{storageName}} is not installed or your configuration is not right', { storageName }).yellow);
        self.logger.info(__('You can install and get more information here: ').yellow + References[storageName].underline);
        return callback(__('%s not installed', storageName));
      }

      self.logger.info(__(`Starting %s process`, storageName).cyan);
      self.processes[storageName] = new ProcessLauncher({
        modulePath: filePath,
        name: storageName,
        logger: self.logger,
        events: self.events,
        embark: self.embark,
        silent: self.logger.logLevel !== 'trace',
        exitCallback: self.processExited.bind(this, storageName)
      });
      this.events.request("blockchain:object", (blockchain) => {
        blockchain.onReady(() => {
          blockchain.determineDefaultAccount((err, defaultAccount) => {
            if (err) {
              return callback(err);
            }
            self.processes[storageName].send({
              action: constants.storage.init, options: {
                storageConfig: self.storageConfig,
                blockchainConfig: self.blockchainConfig,
                cors: self.buildCors(),
                defaultAccount: defaultAccount
              }
            });
          });
        });
      });


      self.processes[storageName].on('result', constants.storage.initiated, (msg) => {
        console.dir("got result from process")
        console.dir(msg)
        if (msg.error) {
          self.processes[storageName].disconnect();
          delete self.processes[storageName];
          return callback(msg.error);
        }
        self.logger.info(__(`${storageName} process started`).cyan);
        callback();
      });

      self.processes[storageName].on('result', constants.storage.restart, (_msg) => {
        console.dir("got result from process")
        console.dir(_msg)
        self.restartCalled = true;
        self.logger.info(__(`Restarting ${storageName} process...`).cyan);
        self.processes[storageName].kill();
        delete this.processes[storageName];
      });

      self.processes[storageName].on('result', constants.storage.exit, (_msg) => {
        console.dir("got result from process")
        console.dir(_msg)
        self.processes[storageName].kill();
        delete this.processes[storageName];
        this.events.emit(constants.storage.exit);
      });

      self.events.on('logs:swarm:enable', () => {
        self.processes[storageName].silent = false;
      });

      self.events.on('logs:swarm:disable', () => {
        self.processes[storageName].silent = true;
      });

    });
  }
  stopProcess(storageName, cb) {
    if (this.processes[storageName]) {
      this.manualExit = true;
      this.events.once(constants.storage.exit, cb);
      this.processes[storageName].send('exit');
    }
  }
}

module.exports = StorageProcessesLauncher;