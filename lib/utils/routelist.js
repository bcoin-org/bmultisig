/*!
 * routelist.js - route list manager
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const Route = require('bweb/lib/route');

// handler for Route
const _handler = (req, res) => {};

/**
 * Route List
 * @ignore
 */
class RouteList {
  /**
   * Create a route list.
   * @constructor
   */

  constructor() {
    this._get = [];
    this._post = [];
    this._put = [];
    this._del = [];
  }

  /**
   * Get lists by methods.
   * @private
   * @param {String} method
   * @returns {RouteItem[]}
   */

  _handlers(method) {
    assert(typeof method === 'string');
    switch (method.toUpperCase()) {
      case 'GET':
        return this._get;
      case 'POST':
        return this._post;
      case 'PUT':
        return this._put;
      case 'DELETE':
        return this._del;
      default:
        return null;
    }
  }

  /**
   * check if request matches route in list
   * @param {Request} req
   * @param {Response} res
   * @returns {Boolean}
   */

  has(req) {
    const routes = this._handlers(req.method);

    if (!routes)
      return false;

    for (const route of routes) {
      const params = route.match(req.pathname);

      if (!params)
        continue;

      req.params = params;

      return true;
    }

    return false;
  }

  /**
   * Add a GET route.
   * @param {String} path
   * @param {Function} handler
   */

  get(path) {
    this._get.push(new ListItem(path));
  }

  /**
   * Add a POST route.
   * @param {String} path
   * @param {Function} handler
   */

  post(path) {
    this._post.push(new ListItem(path));
  }

  /**
   * Add a PUT route.
   * @param {String} path
   * @param {Function} handler
   */

  put(path) {
    this._put.push(new ListItem(path));
  }

  /**
   * Add a DELETE route.
   * @param {String} path
   * @param {Function} handler
   */

  del(path) {
    this._del.push(new ListItem(path));
  }
}

/**
 * Route list item
 * @ignore
 */
class ListItem extends Route {
  /**
   * Create a route list item.
   * @constructor
   * @ignore
   */

  constructor(path) {
    super(path, _handler);
  }
}

module.exports = RouteList;
