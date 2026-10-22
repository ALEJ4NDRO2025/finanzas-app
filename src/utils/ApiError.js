'use strict';

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.isOperational = true; // error esperado: se puede mostrar al cliente
  }
}

module.exports = ApiError;
