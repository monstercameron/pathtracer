import { signal } from '@preact/signals';

export const LOGGER_CHANNELS = Object.freeze([
  'renderer',
  'physics',
  'sceneLoad',
  'ui',
  'assetPipeline'
]);

export const LOGGER_LEVELS = Object.freeze([
  'debug',
  'info',
  'warn',
  'error'
]);

export const LOGGER_DEBUG_STORAGE_PREFIX = 'pathtracer.debug.';
export const LOGGER_GLOBAL_DEBUG_STORAGE_KEY = `${LOGGER_DEBUG_STORAGE_PREFIX}all`;
export const LOGGER_ENTRY_LIMIT = 500;
export const LOGGER_ISSUE_LEVELS = Object.freeze([
  'warn',
  'error'
]);

const LOGGER_LEVEL_METHODS = Object.freeze({
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error'
});

const TRUTHY_STORAGE_VALUES = Object.freeze(new Set([
  '1',
  'true',
  'yes',
  'on',
  'debug',
  'enabled'
]));

const FALSY_STORAGE_VALUES = Object.freeze(new Set([
  '0',
  'false',
  'no',
  'off',
  'disabled'
]));

const isKnownLoggerChannel = (channelName) => LOGGER_CHANNELS.includes(channelName);
const isKnownLoggerLevel = (levelName) => LOGGER_LEVELS.includes(levelName);

const LOGGER_ISSUE_LEVEL_SET = Object.freeze(new Set(LOGGER_ISSUE_LEVELS));

export const loggerEntries = signal(Object.freeze([]));
export const loggerIssueEntries = signal(Object.freeze([]));

const readStorageValue = (storage, key) => {
  if (!storage || typeof storage.getItem !== 'function') {
    return null;
  }

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorageValue = (storage, key, value) => {
  if (!storage) {
    return false;
  }

  try {
    if (value === null) {
      if (typeof storage.removeItem === 'function') {
        storage.removeItem(key);
        return true;
      }
      return false;
    }

    if (typeof storage.setItem === 'function') {
      storage.setItem(key, value);
      return true;
    }
  } catch {
    return false;
  }

  return false;
};

export const getLoggerStorage = () => {
  if (typeof globalThis === 'undefined') {
    return null;
  }

  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

export const getLoggerDebugStorageKey = (channelName) => (
  `${LOGGER_DEBUG_STORAGE_PREFIX}${channelName}`
);

const readStorageFlag = (storage, key) => {
  const rawValue = readStorageValue(storage, key);
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  const normalizedValue = String(rawValue).trim().toLowerCase();
  if (TRUTHY_STORAGE_VALUES.has(normalizedValue)) {
    return true;
  }
  if (FALSY_STORAGE_VALUES.has(normalizedValue)) {
    return false;
  }

  return Boolean(normalizedValue);
};

export const isLoggerDebugEnabled = (channelName, options = {}) => {
  if (!isKnownLoggerChannel(channelName)) {
    return false;
  }

  const storage = options.storage === undefined ? getLoggerStorage() : options.storage;
  const channelFlag = readStorageFlag(storage, getLoggerDebugStorageKey(channelName));
  if (channelFlag !== null) {
    return channelFlag;
  }

  return readStorageFlag(storage, LOGGER_GLOBAL_DEBUG_STORAGE_KEY) === true;
};

export const setLoggerDebugEnabled = (channelName, isEnabled, options = {}) => {
  if (!isKnownLoggerChannel(channelName)) {
    return false;
  }

  const storage = options.storage === undefined ? getLoggerStorage() : options.storage;
  return writeStorageValue(
    storage,
    getLoggerDebugStorageKey(channelName),
    isEnabled === null ? null : (isEnabled ? '1' : '0')
  );
};

const readConsoleObject = (consoleObject) => {
  if (consoleObject !== undefined) {
    return consoleObject;
  }
  if (typeof globalThis !== 'undefined' && globalThis.console) {
    return globalThis.console;
  }
  return null;
};

const getConsoleMethod = (consoleObject, levelName) => {
  if (!consoleObject) {
    return null;
  }

  const methodName = LOGGER_LEVEL_METHODS[levelName] || 'log';
  if (typeof consoleObject[methodName] === 'function') {
    return consoleObject[methodName].bind(consoleObject);
  }
  if (typeof consoleObject.log === 'function') {
    return consoleObject.log.bind(consoleObject);
  }

  return null;
};

export const createLoggerEntry = (channelName, levelName, message, details) => ({
  channel: channelName,
  level: levelName,
  message: String(message),
  details,
  timestamp: new Date().toISOString()
});

const appendCapturedLoggerEntry = (entriesSignal, entry) => {
  const currentEntries = entriesSignal.value;
  const nextEntries = currentEntries.length >= LOGGER_ENTRY_LIMIT
    ? currentEntries.slice(currentEntries.length - LOGGER_ENTRY_LIMIT + 1)
    : currentEntries.slice();
  nextEntries.push(entry);
  entriesSignal.value = Object.freeze(nextEntries);
  return entry;
};

export const captureLoggerEntry = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  appendCapturedLoggerEntry(loggerEntries, entry);
  if (LOGGER_ISSUE_LEVEL_SET.has(entry.level)) {
    appendCapturedLoggerEntry(loggerIssueEntries, entry);
  }
  return entry;
};

export const clearLoggerEntries = () => {
  loggerEntries.value = Object.freeze([]);
  loggerIssueEntries.value = Object.freeze([]);
  return loggerEntries.value;
};

export const createLogger = (channelName, options = {}) => {
  if (!isKnownLoggerChannel(channelName)) {
    throw new TypeError(`Unknown logger channel: ${channelName}`);
  }

  const shouldLog = (levelName) => (
    levelName !== 'debug' || isLoggerDebugEnabled(channelName, options)
  );

  const write = (levelName, message, details) => {
    if (!isKnownLoggerLevel(levelName) || !shouldLog(levelName)) {
      return null;
    }

    const entry = createLoggerEntry(channelName, levelName, message, details);
    captureLoggerEntry(entry);

    const consoleMethod = getConsoleMethod(readConsoleObject(options.console), levelName);
    if (consoleMethod) {
      consoleMethod(entry);
    }

    return entry;
  };

  return Object.freeze({
    channel: channelName,
    debug: (message, details) => write('debug', message, details),
    info: (message, details) => write('info', message, details),
    warn: (message, details) => write('warn', message, details),
    error: (message, details) => write('error', message, details),
    isDebugEnabled: () => isLoggerDebugEnabled(channelName, options)
  });
};

export const logger = Object.freeze(Object.fromEntries(
  LOGGER_CHANNELS.map((channelName) => [channelName, createLogger(channelName)])
));

export const rendererLogger = logger.renderer;
export const physicsLogger = logger.physics;
export const sceneLoadLogger = logger.sceneLoad;
export const uiLogger = logger.ui;
export const assetPipelineLogger = logger.assetPipeline;

if (typeof globalThis !== 'undefined') {
  const existingLoggers = globalThis.pathTracerLoggers && typeof globalThis.pathTracerLoggers === 'object'
    ? globalThis.pathTracerLoggers
    : {};
  globalThis.pathTracerLoggers = {
    ...existingLoggers,
    ...logger
  };
  globalThis.pathTracerAssetPipelineLogger = assetPipelineLogger;
}

export default logger;
