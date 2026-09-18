// @knowzy/authorization
//
// Policy registry and engine, permission resolution, and DataScope
// construction — access-control.md.
//
// Boundary: no database import. Subjects and their scopes arrive already
// resolved, which keeps this package pure and leaves one resolution path in
// @knowzy/database.

export * from './policies.js';
export * from './engine.js';
