export const environment = {
  /** Where the .NET API is listening. */
  apiUrl: 'http://localhost:5120/api',

  /** Same host without /api — uploaded photos are served from here as plain static files. */
  filesUrl: 'http://localhost:5120',

  /** The SignalR endpoint. Same origin as the API; a different path, not a different server. */
  hubUrl: 'http://localhost:5120/hubs',
};
