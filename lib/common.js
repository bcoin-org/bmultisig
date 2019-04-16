/*!
 * common.js - Common constants.
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 */

'use strict';

/**
 * Payload types for proposals.
 * @enum {ProposalPayloadType}
 */

exports.payloadType = {
  /*
   * When signing proposal create.
   */

  CREATE: 0,

  /*
   * When signing proposal rejection.
   */

  REJECT: 1
};

/**
 * payload types by value
 * @const {Object}
 */

exports.payloadTypeByVal = {
  0: 'CREATE',
  1: 'REJECT'
};
