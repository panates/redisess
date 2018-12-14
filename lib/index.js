/*
 ------------------------
 (c) 2017-present Panates
 May be freely distributed under the MIT license.
 */

/**
 * Module dependencies.
 * @private
 */
const SessionManager = require('./SessionManager');

module.exports = function(...args) {
  return new SessionManager(...args);
};

Object.assign(module.exports, {
  SessionManager
});

